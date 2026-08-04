"""Package routes: intake, compile retry, payment provisioning, and the
package-scoped read feeds the dashboards poll.

Grouped by the resource in the path, which is why POST /packages/{id}/paid
lives here rather than in orders.py: it is a write on a package (404s on an
unknown package, refuses an owner mismatch, flips the package's paid state)
that records an order on the way. GET /users/{id}/packages is here for the
same reason inverted -- its path says users, but packages are what it
returns and what it reads.
"""
from __future__ import annotations

import base64
import binascii
import logging
from datetime import datetime

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError as PostgrestAPIError
from pydantic import BaseModel, ConfigDict

from scorer.api.db import OrderRow, PackageRow
from scorer.api.deps import Deps
from scorer.api.jobs import compile_package_job
from scorer.api.quota import sessions_used
from scorer.api.responses import rate_limited
from scorer.api.routers.sessions import stopped_reporting
from scorer.config import load_product_config
from scorer.intake.jd import JdFetchError
from scorer.intake.profile import extract_pdf_text
from scorer.promptsafe import (
    classify_injection,
    profile_refusal_message,
    strip_hidden_text,
)

logger = logging.getLogger(__name__)


class CreatePackageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jd_text: str | None = None
    jd_url: str | None = None
    resume_text: str | None = None
    resume_pdf_b64: str | None = None
    linkedin_text: str | None = None
    linkedin_pdf_b64: str | None = None
    # Packages are born bound: the auth-gated /new route sends the creating
    # account's id so new rows never go through an unclaimed phase. Optional
    # because the legacy claim-by-token flow still creates unbound packages.
    user_id: str | None = None


class MarkPaidRequest(BaseModel):
    """Order details the web's Polar webhook forwards (worker.ts
    PaidOrderBody mirrors this shape field-for-field). paid_at anchors the
    30-day expiry window at the payment moment, never at processing time."""

    model_config = ConfigDict(extra="forbid")

    user_id: str
    polar_order_id: str
    polar_checkout_id: str | None = None
    amount_minor: int | None = None
    currency: str | None = None
    status: str | None = None
    paid_at: str


def _extract_pdf_upload(pdf_b64: str, label: str) -> str:
    """b64 -> PDF text with every failure a clean 422 (the cap on the
    encoded LENGTH ran earlier, before this decode)."""
    try:
        raw = base64.b64decode(pdf_b64, validate=True)
    except binascii.Error as exc:
        raise HTTPException(
            status_code=422,
            detail=f"the {label} upload is not valid base64",
        ) from exc
    try:
        return extract_pdf_text(raw)
    except Exception as exc:
        # types on attacker-controlled bytes; every one is a client
        # problem, never a worker 500.
        raise HTTPException(
            status_code=422,
            detail=f"could not read the {label} PDF — export it again "
                   "and retry",
        ) from exc


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    # Unpacked once so the route bodies below stay exactly what they were
    # inside the create_app closure -- this split must not change behaviour.
    db = deps.db
    storage = deps.storage
    client = deps.client
    limits = deps.limits
    session_config = load_product_config().session
    package_create_limiter = deps.package_create_limiter
    compile_retry_attempts = deps.compile_retry_attempts
    fetch_jd = deps.fetch_jd

    @router.post("/packages", status_code=202)
    def create_package(body: CreatePackageRequest, background_tasks: BackgroundTasks):
        # Checked before any JD fetch or PDF decode: a request that cannot
        # produce a package must not first spend an outbound HTTP call on it.
        # Unowned requests have no account to count against the absolute cap.
        owned = (db.list_packages_by_user(body.user_id)
                 if body.user_id is not None else [])
        if body.user_id is not None and len(owned) >= limits.max_packages_per_user:
            return JSONResponse(
                status_code=429,
                content={
                    "error": "package limit reached — contact support to raise it",
                    "code": "package-cap",
                },
            )
        if not package_create_limiter.hit(body.user_id or "-unbound-"):
            return rate_limited("package-create")
        # Length caps run before any fetch, decode, or insert: an over-limit
        # request must cost nothing (F-29; the worker is on a public domain,
        # so no proxy body limit backstops it). The JD cap itself runs after
        # jd_text/jd_url resolution below — it has to cover fetched pages.
        for label, text in (("resume", body.resume_text),
                            ("LinkedIn", body.linkedin_text)):
            if text is not None and len(text) > limits.profile_text_max_chars:
                return JSONResponse(
                    status_code=422,
                    content={"error": f"the {label} text is too long — trim "
                                      "it to the relevant experience"},
                )
        for label, pdf_b64 in (("resume", body.resume_pdf_b64),
                               ("LinkedIn", body.linkedin_pdf_b64)):
            if pdf_b64 is not None and len(pdf_b64) > limits.pdf_b64_max_chars:
                return JSONResponse(
                    status_code=422,
                    content={"error": f"the {label} PDF is too large — "
                                      "export a smaller one and retry"},
                )
        if body.jd_text is not None:
            jd_text = body.jd_text
        elif body.jd_url is not None:
            try:
                jd_text = fetch_jd(body.jd_url)
            except (JdFetchError, httpx.HTTPError):
                # Unsafe/unfetchable URL is a client problem, never a 500;
                # the message stays generic (no echoed URL, no exception text).
                return JSONResponse(
                    status_code=422,
                    content={
                        "error": "could not fetch that URL; paste the JD text instead"
                    },
                )
        else:
            raise HTTPException(
                status_code=422, detail="one of jd_text or jd_url is required"
            )
        # F-11a: hidden-payload carriers (HTML comments/tags, zero-width and
        # bidi characters) are stripped from every intake text at this one
        # chokepoint — the stored jd_text is the cleaned text, so prompts,
        # dedup, and rubric-reuse all see the same version.
        jd_text = strip_hidden_text(jd_text)
        if len(jd_text) > limits.jd_text_max_chars:
            # A fetched page can be over the cap too; same honest rejection.
            # Deliberately ahead of the injection scan below: the length
            # check is O(1) and the scan is not, so an oversized document
            # is rejected on the cheap test (F-29's "an over-limit request
            # must cost nothing").
            return JSONResponse(
                status_code=422,
                content={"error": "that job description is too long — paste "
                                  "the posting itself, not the whole page"},
            )
        # F-11b: a document that is an instruction set rather than a job
        # description is refused HERE, before the insert and before any
        # model call. The rubric it would compile IS the bar the customer
        # is then measured against, so quietly compiling one an attacker
        # wrote is not a prompt-safety inconvenience -- it is the product
        # selling a verdict against the wrong standard.
        verdict = classify_injection(jd_text)
        if verdict.refused:
            # Signals, never the text: an operator log must not become a
            # place attacker-controlled content gets replayed.
            logger.warning(
                "refused a job description that reads as instructions "
                "(user_id=%s signals=%s)", body.user_id, list(verdict.signals))
            return JSONResponse(
                status_code=422,
                content={"error": verdict.message,
                         "code": "jd-not-a-job-description"},
            )
        resume_text = body.resume_text
        if resume_text is None and body.resume_pdf_b64 is not None:
            resume_text = _extract_pdf_upload(body.resume_pdf_b64, "resume")
        if resume_text is not None:
            resume_text = strip_hidden_text(resume_text)
        linkedin_text = body.linkedin_text
        if linkedin_text is None and body.linkedin_pdf_b64 is not None:
            linkedin_text = _extract_pdf_upload(body.linkedin_pdf_b64, "LinkedIn")
        if linkedin_text is not None:
            linkedin_text = strip_hidden_text(linkedin_text)
        # F-11b, the second vector: resume/LinkedIn text becomes the
        # candidate_profile, which is interpolated into the interviewer's
        # SYSTEM prompt. A crafted "name" is a persona injection, so the
        # source documents face the same door as the JD.
        for label, text in (("resume", resume_text),
                            ("LinkedIn profile", linkedin_text)):
            if text is None:
                continue
            profile_verdict = classify_injection(text)
            if profile_verdict.refused:
                logger.warning(
                    "refused a %s that reads as instructions (user_id=%s "
                    "signals=%s)", label, body.user_id,
                    list(profile_verdict.signals))
                return JSONResponse(
                    status_code=422,
                    content={"error": profile_refusal_message(label),
                             "code": "profile-not-a-document"},
                )
        # Trial model (F-24): the account's FIRST package is the trial. The
        # flag is cosmetic-plus-records -- the money chokepoint is paid_at
        # (effective_total_sessions) -- but the web renders trial state from
        # it, so it is set exactly once, at birth.
        is_trial = body.user_id is not None and not owned
        row = db.create_package(jd_text, body.jd_url, user_id=body.user_id,
                                is_trial=is_trial)
        # Born touched: if the compile dies before its first status write the
        # stuck-state reaper must still see a clock on the row (NULL
        # updated_at rows are invisible to it by contract).
        db.touch_updated_at("package", row.id)
        cached = (
            db.find_ready_rubric_by_jd(jd_text, body.user_id)
            if resume_text is None and linkedin_text is None
            else None
        )
        if cached is not None:
            # Same JD, same account, no personalization inputs: the compile
            # output is reusable -- copy it instead of paying for and waiting
            # on another Gemini run (~100-200 s measured). The account match
            # is what makes copying candidate_profile safe.
            profile, rubric = cached
            if profile is not None:
                db.set_package_profile(row.id, profile)
            db.set_package_rubric(row.id, rubric, "ready")
            db.touch_updated_at("package", row.id)
        else:
            background_tasks.add_task(
                compile_package_job,
                row.id,
                db,
                storage,
                client,
                resume_text=resume_text,
                linkedin_text=linkedin_text,
            )
        return {"package_id": row.id, "access_token": row.access_token}

    @router.post("/packages/{package_id}/compile-retry", status_code=202)
    def retry_compile(package_id: str, background_tasks: BackgroundTasks):
        """Reset a failed-compile package and re-enqueue compilation (F-30).

        Only "failed" rows are retryable; the cap keeps a permanently broken
        JD from buying unlimited Gemini runs. The retry carries no source
        documents (they are never stored) — compile_package keeps the
        profile the original compile extracted.
        """
        try:
            package = db.get_package(package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        if package.status != "failed":
            return JSONResponse(
                status_code=409,
                content={
                    "error": (f"package status is {package.status!r}; only a "
                              "failed compile can be retried"),
                    "code": "not-retryable",
                },
            )
        if compile_retry_attempts.bump(package_id) > limits.compile_retry_cap:
            return JSONResponse(
                status_code=429,
                content={
                    "error": ("compile retry limit reached for this package "
                              "— contact support"),
                    "code": "compile-retry-cap",
                },
            )
        db.reset_package_for_compile(package_id)
        background_tasks.add_task(
            compile_package_job, package_id, db, storage, client,
            resume_text=None, linkedin_text=None,
        )
        logger.info("package %s re-enqueued for compile", package_id)
        return {"package_id": package_id, "status": "compiling"}

    @router.post("/packages/{package_id}/paid")
    def mark_package_paid(package_id: str, body: MarkPaidRequest):
        """Provision a Polar payment: order row + paid package state.

        Replay-safe twice over: polar_order_id is the idempotency key, and
        set_package_paid is first-write-wins, so a replay can never move the
        expiry window. A replay of a KNOWN order re-asserts the paid flip
        (never skips it): a crash between insert_order and set_package_paid
        would otherwise leave a paid-for package locked at one session with
        every retry short-circuiting past the repair.
        """
        try:
            package = db.get_package(package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        try:
            paid_at = datetime.fromisoformat(body.paid_at)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail="paid_at must be an ISO-8601 timestamp",
            ) from exc
        if paid_at.tzinfo is None:
            # The money anchor must be unambiguous: a naive timestamp would
            # silently shift the 30-day window by the sender's UTC offset.
            raise HTTPException(
                status_code=422,
                detail="paid_at must carry an explicit UTC offset",
            )
        if package.user_id is not None and package.user_id != body.user_id:
            # A webhook that resolved the wrong account must not provision
            # anything: refuse loudly, write nothing.
            return JSONResponse(
                status_code=409,
                content={
                    "error": "order user does not match the package owner",
                    "code": "user-mismatch",
                },
            )

        def _order_package_mismatch(order: OrderRow) -> JSONResponse:
            # One Polar order provisions exactly one package: answering
            # "duplicate" for a different package_id would claim (and with
            # the heal below, mark) the wrong package as paid.
            logger.warning(
                "polar order %s already provisioned package %s; refusing "
                "replay aimed at package %s",
                body.polar_order_id, order.package_id, package_id,
            )
            return JSONResponse(
                status_code=409,
                content={
                    "error": "this Polar order provisioned a different package",
                    "code": "order-package-mismatch",
                },
            )

        existing = db.find_order_by_polar_id(body.polar_order_id)
        if existing is not None:
            if existing.package_id != package_id:
                return _order_package_mismatch(existing)
            # Replay heal: first-write-wins makes this a no-op on an
            # already-paid package and a repair on one orphaned mid-crash.
            db.set_package_paid(package_id, existing.id, body.paid_at)
            return {"package_id": package_id, "order_id": existing.id,
                    "duplicate": True}
        try:
            order = db.insert_order(OrderRow(
                user_id=body.user_id,
                package_id=package_id,
                polar_order_id=body.polar_order_id,
                polar_checkout_id=body.polar_checkout_id,
                amount_minor=body.amount_minor,
                currency=body.currency,
                status=body.status,
            ))
        except (ValueError, PostgrestAPIError):
            # Lost an insert race with a concurrent delivery of the same
            # order (unique polar_order_id): the winner's row is the answer,
            # and the paid flip is re-asserted in case the winner dies
            # between its insert and its own set_package_paid.
            raced = db.find_order_by_polar_id(body.polar_order_id)
            if raced is None:
                raise
            if raced.package_id != package_id:
                return _order_package_mismatch(raced)
            db.set_package_paid(package_id, raced.id, body.paid_at)
            return {"package_id": package_id, "order_id": raced.id,
                    "duplicate": True}
        db.set_package_paid(package_id, order.id, body.paid_at)
        logger.info(
            "package %s provisioned paid (order_id=%s)", package_id, order.id
        )
        return {"package_id": package_id, "order_id": order.id,
                "duplicate": False}

    @router.get("/packages/by-token/{access_token}")
    def get_package_by_token(access_token: str) -> PackageRow:
        try:
            return db.get_package_by_token(access_token)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc

    @router.get("/packages/{package_id}/sessions")
    def list_package_sessions(package_id: str) -> dict:
        try:
            db.get_package(package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        return {"sessions": [
            {
                "id": row.id,
                "index": row.index,
                "status": row.status,
                "created_at": row.created_at,
                "stopped_reporting": stopped_reporting(
                    row,
                    session_config.hard_cut_minutes,
                    session_config.heartbeat_stale_after_s,
                ),
                # Verdict + stage ride the summary (WP-D) so the archive can
                # label every row without an N+1 of full-session GETs.
                "scoring_stage": row.scoring_stage,
                "report_available": row.report is not None,
                "overall": row.report.overall_score if row.report is not None else None,
                "verdict": row.report.verdict if row.report is not None else None,
            }
            for row in db.list_sessions(package_id)
            if row.status != "abandoned"
        ]}

    @router.get("/packages/{package_id}/progress")
    def get_package_progress(package_id: str) -> dict:
        """Per-session trend feed (WP-C): pure assembly over ONE list call.

        Slimmed on purpose -- rationale and evidence stay on the session
        detail; this feed carries only what trend math needs. Every row rides
        along regardless of status (the UI decides how unscored attempts
        appear on the timeline); score fields are null/[] until a report
        exists. Silence stats are reduced here so no client re-derives them.
        """
        try:
            package = db.get_package(package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        entries = []
        for row in db.list_sessions(package_id):
            report = row.report
            silence = None
            if report is not None:
                events = report.delivery_metrics.silence_events
                # Rounded so JSON never carries float-sum dust.
                silence = {
                    "count": len(events),
                    "total_s": round(sum(e.duration_s for e in events), 2),
                    "longest_s": round(
                        max((e.duration_s for e in events), default=0.0), 2
                    ),
                }
            entries.append({
                "session_id": row.id,
                "index": row.index,
                "created_at": row.created_at,
                "status": row.status,
                "verdict": report.verdict if report is not None else None,
                "overall": report.overall_score if report is not None else None,
                "dimension_scores": [
                    {"dimension_key": s.dimension_key, "score": s.score}
                    for s in (report.dimension_scores if report is not None else [])
                ],
                "wpm_overall": (
                    report.delivery_metrics.wpm_overall
                    if report is not None else None
                ),
                "filler_rate_per_min": (
                    report.delivery_metrics.filler_rate_per_min
                    if report is not None else None
                ),
                "silence": silence,
                "gaps": list(report.gaps) if report is not None else [],
            })
        return {
            "package_id": package_id,
            "total_sessions": package.total_sessions,
            # v0.5: the web derives the effective session count and expiry
            # copy from these -- summaries must never force a full-row GET.
            "is_trial": package.is_trial,
            "paid_at": package.paid_at,
            "expires_at": package.expires_at,
            "sessions": entries,
        }

    @router.get("/users/{user_id}/packages")
    def list_user_packages(user_id: str) -> dict:
        return {"packages": [
            {
                "id": package.id,
                "access_token": package.access_token,
                "status": package.status,
                "user_id": package.user_id,
                "total_sessions": package.total_sessions,
                # Slot-consuming rows only: a failed/insufficient row keeps
                # its slot, so counting it here made the UI claim a package
                # was complete while the worker would still hand session N
                # back (the "Complete pill + Start session 6" bug).
                "sessions_used": sessions_used(db.list_sessions(package.id)),
                "role_title": (
                    package.rubric.role_title if package.rubric is not None else None
                ),
                "is_trial": package.is_trial,
                "paid_at": package.paid_at,
                "expires_at": package.expires_at,
            }
            for package in db.list_packages_by_user(user_id)
        ]}

    return router
