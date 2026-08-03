"""FastAPI worker: the HTTP surface over the compile and scoring pipelines.

create_app takes its collaborators (database, storage, Gemini client) as
arguments so tests exercise the real HTTP surface against fakes (house
pattern) -- no transport mocking. Auth is one bearer token
(WORKER_API_TOKEN) checked on every /api route; only /healthz is public.
Long jobs run as BackgroundTasks: POST returns 202 and clients poll GET.
"""
from __future__ import annotations

import base64
import binascii
import logging
import os
import secrets
from datetime import datetime
from typing import Annotated

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
)
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError as PostgrestAPIError
from pydantic import BaseModel, ConfigDict

from scorer.api.db import Database, OrderRow, PackageRow, SessionRow
from scorer.api.guards import AttemptCounter, FixedWindowLimiter
from scorer.api.pipeline import compile_package, score_session
from scorer.api.quota import (
    RESUME_COUNTED_STATUSES,
    RETRIABLE_STATUSES,
    TERMINAL_STATUS,
    effective_total_sessions,
    is_expired,
    sessions_used,
)
from scorer.api.storage import Storage
from scorer.config import load_product_config
from scorer.intake.jd import JdFetchError, fetch_jd
from scorer.intake.profile import extract_pdf_text
from scorer.schemas import CandidateProfile, GenAIClientLike
from scorer.sessionplan.planner import (
    build_interviewer_instructions,
    plan_baseline_session,
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


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_id: str


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


class CompleteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_path: str


def _empty_profile() -> CandidateProfile:
    """Fallback when the package has no stored candidate profile."""
    return CandidateProfile(
        name=None, headline=None, years_experience=None,
        roles=[], skills=[], achievements=[],
    )


def _require_worker_token(authorization: Annotated[str, Header()] = "") -> None:
    """Bearer auth against WORKER_API_TOKEN. Never log or echo either value.

    compare_digest keeps the comparison constant-time so response timing
    cannot leak how much of a guessed token matched. The comparison runs on
    bytes: compare_digest raises TypeError on non-ASCII str input, so a
    one-byte header probe would otherwise turn the clean 401 into a 500.
    """
    expected = os.environ.get("WORKER_API_TOKEN", "")
    if not expected or not secrets.compare_digest(
        authorization.encode("utf-8"), f"Bearer {expected}".encode()
    ):
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


def _session_response(row: SessionRow, package: PackageRow) -> dict:
    """The POST /api/sessions payload for a session row (new or existing).

    Callers guarantee row.session_plan and package.rubric are present: a
    session row is only ever created for a "ready" package, with its plan.
    """
    profile = package.candidate_profile
    if profile is None:
        profile = _empty_profile()
    instructions = build_interviewer_instructions(
        row.session_plan, package.rubric, profile
    )
    return {
        "session_id": row.id,
        "index": row.index,
        "session_plan": row.session_plan.model_dump(mode="json"),
        "interviewer_instructions": instructions,
    }


def _score_session_job(
    session_id: str, db: Database, storage: Storage, client: GenAIClientLike
) -> None:
    """Background wrapper: score_session records "failed" itself and re-raises;
    the app swallows here so a broken scoring job can never crash the worker."""
    try:
        score_session(session_id, db, storage, client)
    except Exception:
        logger.exception("background scoring failed: session_id=%s", session_id)


def _compile_package_job(
    package_id: str,
    db: Database,
    storage: Storage,
    client: GenAIClientLike,
    *,
    resume_text: str | None,
    linkedin_text: str | None,
) -> None:
    """Background wrapper mirroring _score_session_job: compile_package records
    "failed" itself, but if even that status write throws (a double fault, e.g.
    a database outage) the app swallows here so the background task can never
    crash the worker -- the row may then stay "compiling" until retried."""
    try:
        compile_package(
            package_id,
            db,
            storage,
            client,
            resume_text=resume_text,
            linkedin_text=linkedin_text,
        )
    except Exception:
        logger.exception("background compile failed: package_id=%s", package_id)


def _rate_limited(action: str) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": f"too many {action} attempts just now — wait a few "
                     "minutes and try again",
            "code": "rate-limited",
        },
    )


def create_app(db: Database, storage: Storage, client: GenAIClientLike) -> FastAPI:
    app = FastAPI(title="flightcheck scorer worker")
    api = APIRouter(prefix="/api", dependencies=[Depends(_require_worker_token)])
    limits = load_product_config().limits

    # Per-user fixed windows plus per-row attempt counters (see guards.py on
    # why process-local is honest here). Keys fall back to the package id for
    # legacy unbound rows so nothing stays uncounted.
    package_create_limiter = FixedWindowLimiter(
        limits.package_create_window_s, limits.package_create_per_window)
    session_create_limiter = FixedWindowLimiter(
        limits.session_create_window_s, limits.session_create_per_window)
    complete_limiter = FixedWindowLimiter(
        limits.complete_window_s, limits.complete_per_window)
    resume_attempts = AttemptCounter()
    score_attempts = AttemptCounter()

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

    @app.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    @api.post("/packages", status_code=202)
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
            return _rate_limited("package-create")
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
        if len(jd_text) > limits.jd_text_max_chars:
            # A fetched page can be over the cap too; same honest rejection.
            return JSONResponse(
                status_code=422,
                content={"error": "that job description is too long — paste "
                                  "the posting itself, not the whole page"},
            )
        resume_text = body.resume_text
        if resume_text is None and body.resume_pdf_b64 is not None:
            resume_text = _extract_pdf_upload(body.resume_pdf_b64, "resume")
        linkedin_text = body.linkedin_text
        if linkedin_text is None and body.linkedin_pdf_b64 is not None:
            linkedin_text = _extract_pdf_upload(body.linkedin_pdf_b64, "LinkedIn")
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
                _compile_package_job,
                row.id,
                db,
                storage,
                client,
                resume_text=resume_text,
                linkedin_text=linkedin_text,
            )
        return {"package_id": row.id, "access_token": row.access_token}

    @api.post("/packages/{package_id}/paid")
    def mark_package_paid(package_id: str, body: MarkPaidRequest):
        """Provision a Polar payment: order row + paid package state.

        Replay-safe twice over: polar_order_id is the idempotency key (a
        known order short-circuits before any write), and set_package_paid
        is first-write-wins, so a replay can never move the expiry window.
        """
        try:
            package = db.get_package(package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        try:
            datetime.fromisoformat(body.paid_at)
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail="paid_at must be an ISO-8601 timestamp",
            ) from exc
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
        existing = db.find_order_by_polar_id(body.polar_order_id)
        if existing is not None:
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
            # order (unique polar_order_id): the winner's row is the answer.
            raced = db.find_order_by_polar_id(body.polar_order_id)
            if raced is None:
                raise
            return {"package_id": package_id, "order_id": raced.id,
                    "duplicate": True}
        db.set_package_paid(package_id, order.id, body.paid_at)
        logger.info(
            "package %s provisioned paid (order_id=%s)", package_id, order.id
        )
        return {"package_id": package_id, "order_id": order.id,
                "duplicate": False}

    @api.get("/orders")
    def list_orders(user_id: str) -> dict:
        """A user's orders, newest first — the OrderHistory receipts feed."""
        return {"orders": [
            order.model_dump(mode="json")
            for order in db.list_orders_for_user(user_id)
        ]}

    @api.get("/packages/by-token/{access_token}")
    def get_package_by_token(access_token: str) -> PackageRow:
        try:
            return db.get_package_by_token(access_token)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc

    @api.get("/packages/{package_id}/sessions")
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
                # Verdict + stage ride the summary (WP-D) so the archive can
                # label every row without an N+1 of full-session GETs.
                "scoring_stage": row.scoring_stage,
                "report_available": row.report is not None,
                "overall": row.report.overall_score if row.report is not None else None,
                "verdict": row.report.verdict if row.report is not None else None,
            }
            for row in db.list_sessions(package_id)
        ]}

    @api.get("/packages/{package_id}/progress")
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

    @api.get("/users/{user_id}/packages")
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

    @api.post("/sessions")
    def create_session(body: CreateSessionRequest):
        """Resume a retriable session or create the package's next session.

        The v0.5 quota chokepoint: an expired paid window rejects every new
        start (410, resumes included -- reads stay open elsewhere); an unpaid
        package exposes exactly one session (effective_total_sessions);
        planned/failed/insufficient rows keep their paid slot and make
        retries idempotent. Completed rows advance the session index;
        recording keys include that index, so each new session has a
        distinct storage path.
        """
        try:
            package = db.get_package(body.package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="package not found") from exc
        if not session_create_limiter.hit(package.user_id or package.id):
            return _rate_limited("session-start")
        if is_expired(package):
            return JSONResponse(
                status_code=410,
                content={
                    "error": ("package expired: the 30-day session window has "
                              "ended — reports and replays stay available"),
                    "code": "package-expired",
                },
            )
        existing = db.list_sessions(body.package_id)
        retriable = sorted(
            (row for row in existing if row.status in RETRIABLE_STATUSES),
            key=lambda row: row.index,
        )
        for row in retriable:
            if row.status not in RESUME_COUNTED_STATUSES:
                # A planned row never ran: resuming it is free, always.
                return _session_response(row, package)
            if resume_attempts.bump(row.id) <= limits.resume_attempt_cap:
                return _session_response(row, package)
            # Past the cap: retire the row and spend its slot, so the answer
            # below is honestly "next session" or "exhausted" — never an
            # endless retry loop on a session that keeps dying (F-30).
            db.set_session_status(row.id, TERMINAL_STATUS)
            db.touch_updated_at("session", row.id)
            logger.info(
                "session %s retired after %d resume attempts",
                row.id, limits.resume_attempt_cap,
            )
        if retriable:
            existing = db.list_sessions(body.package_id)
        total = effective_total_sessions(package)
        if sessions_used(existing) >= total:
            used_line = (
                "the included session is used" if total == 1
                else f"all {total} sessions used"
            )
            return JSONResponse(
                status_code=409,
                content={
                    "error": f"package exhausted: {used_line}",
                    "code": "package-exhausted",
                },
            )
        if package.status != "ready" or package.rubric is None:
            return JSONResponse(
                status_code=409,
                content={
                    "error": (f"package status is {package.status!r}; "
                              "sessions need 'ready'"),
                    "code": "package-not-ready",
                },
            )
        plan = plan_baseline_session(package.rubric)
        next_index = max((row.index for row in existing), default=0) + 1
        row = db.create_session(body.package_id, next_index, plan)
        db.touch_updated_at("session", row.id)
        return _session_response(row, package)

    @api.post("/sessions/{session_id}/complete", status_code=202)
    def complete_session(
        session_id: str, body: CompleteSessionRequest, background_tasks: BackgroundTasks
    ):
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        if row.status in ("scoring", "scored"):
            # Scoring is the expensive paid trigger; a session is scored at
            # most once. "planned" starts a run and "failed" allows a retry.
            return JSONResponse(
                status_code=409,
                content={
                    "error": f"session is already {row.status}; it cannot be re-scored"
                },
            )
        if row.status == TERMINAL_STATUS:
            return JSONResponse(
                status_code=409,
                content={
                    "error": ("this session was retired after repeated "
                              "attempts and cannot be scored again"),
                    "code": "session-terminal",
                },
            )
        package = db.get_package(row.package_id)
        if not complete_limiter.hit(package.user_id or row.package_id):
            return _rate_limited("scoring")
        if score_attempts.bump(session_id) > limits.score_attempt_cap:
            # The scoring pipeline keeps dying on this recording: burning
            # more model spend on it will not change the outcome, so the
            # row is retired and its slot spent (F-30).
            db.set_session_status(session_id, TERMINAL_STATUS)
            db.touch_updated_at("session", session_id)
            logger.info(
                "session %s retired after %d scoring attempts",
                session_id, limits.score_attempt_cap,
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": ("scoring attempt limit reached for this "
                              "session — the slot is closed"),
                    "code": "score-attempt-cap",
                },
            )
        db.set_session_status(session_id, "scoring", audio_path=body.audio_path)
        db.touch_updated_at("session", session_id)
        background_tasks.add_task(_score_session_job, session_id, db, storage, client)
        return {"session_id": session_id, "status": "scoring"}

    @api.post("/sessions/{session_id}/secret-mint")
    def mint_session_secret(session_id: str):
        """Count one realtime-secret mint against the session's cap.

        DB-backed (migration 005): the count survives worker restarts, so
        this is the durable per-session bound on OpenAI Realtime spend. The
        web's realtime-secret route calls this BEFORE minting and refuses
        on 429.
        """
        try:
            db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        count = db.increment_secret_mints(session_id)
        if count > limits.secret_mint_cap:
            return JSONResponse(
                status_code=429,
                content={
                    "error": ("this session has reached its live-interview "
                              "connection limit"),
                    "code": "mint-cap",
                    "secret_mints": count,
                },
            )
        return {"session_id": session_id, "secret_mints": count}

    @api.get("/sessions/{session_id}/transcript")
    def get_session_transcript(session_id: str) -> dict:
        """The verbatim transcript, or segments=null when none is stored.

        A dedicated endpoint on purpose: transcripts run 25-60KB and must
        never ride the hot session-row polls. Null (not 404, not []) is the
        honest state for sessions scored before transcripts were persisted.
        """
        try:
            segments = db.get_transcript(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        return {
            "session_id": session_id,
            "segments": (
                None if segments is None
                else [seg.model_dump(mode="json") for seg in segments]
            ),
        }

    @api.get("/sessions/{session_id}")
    def get_session(session_id: str) -> dict:
        """SessionRow fields + interviewer_instructions rebuilt on every read.

        The instructions are deterministic (plan + rubric + profile are all
        stored), so they are never persisted on the session row; only
        server-side callers -- the Next.js secret-minting route -- ever see
        them, and the browser has no other path to them.
        """
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        package = db.get_package(row.package_id)
        instructions = ""
        if row.session_plan is not None and package.rubric is not None:
            profile = package.candidate_profile
            if profile is None:
                profile = _empty_profile()
            instructions = build_interviewer_instructions(
                row.session_plan, package.rubric, profile
            )
        payload = row.model_dump(mode="json")
        payload["interviewer_instructions"] = instructions
        return payload

    app.include_router(api)
    return app


def main() -> None:
    """Deploy entrypoint: real Supabase + Gemini clients from env.

    scorer.env exposes load_env()/require_key() -- .env is authoritative
    (override=True) and a missing key fails loudly at startup (never
    load_dotenv). create_supabase_client() reads SUPABASE_URL and
    SUPABASE_SERVICE_ROLE_KEY itself; ONE Supabase client is built here
    and shared by SupabaseDatabase and SupabaseStorage (Task 2's
    composition contract).
    """
    import uvicorn

    from scorer.api.db import SupabaseDatabase, create_supabase_client
    from scorer.api.storage import SupabaseStorage
    from scorer.env import load_env, require_key
    from scorer.genai_compat import make_client

    load_env()
    require_key("WORKER_API_TOKEN")
    gemini_key = require_key("GEMINI_API_KEY")
    supabase = create_supabase_client()
    app = create_app(
        db=SupabaseDatabase(supabase),
        storage=SupabaseStorage(supabase),
        client=make_client(gemini_key),
    )
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
