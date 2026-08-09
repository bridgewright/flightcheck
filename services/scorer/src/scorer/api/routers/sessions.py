"""Session routes: start/resume, the scoring trigger, the realtime-secret
mint counter, and the two reads (transcript, full row).

Every quota and attempt guard the product sells sits on this surface, so the
route bodies are moved from create_app unchanged -- the v0.6 split may not
alter a single refusal.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from scorer.api.db import PackageRow, SessionRow
from scorer.api.deps import Deps
from scorer.api.jobs import score_session_job
from scorer.api.quota import (
    RESUME_COUNTED_STATUSES,
    RETRIABLE_STATUSES,
    TERMINAL_STATUS,
    effective_total_sessions,
    is_expired,
    sessions_used,
)
from scorer.api.responses import rate_limited
from scorer.config import load_product_config
from scorer.schemas import (
    CandidateProfile,
    ParaphraseMark,
    ParaphraseMarks,
    SessionInsights,
    SessionParaphrases,
)
from scorer.sessionplan.planner import (
    build_interviewer_instructions,
    plan_baseline_session,
    plan_quick_session,
)

logger = logging.getLogger(__name__)


class CreateSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_id: str


class CompleteSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_path: str | None = None


class ReclaimSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    package_id: str


class CoachingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    paraphrases: SessionParaphrases | None
    insights: SessionInsights | None
    marks: ParaphraseMarks


class SetCoachingMarkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_index: int = Field(ge=0)
    mark: ParaphraseMark


def live_session(
    rows: Iterable[SessionRow],
    hard_cut_minutes: float,
    heartbeat_stale_after_s: float | None = None,
) -> SessionRow | None:
    """The session somebody is in RIGHT NOW, or None (F-38).

    Three conditions, all derived from state that already exists:

    * status "planned" -- the interview has not been handed to the scorer
      yet. A "scoring" row runs on the worker for minutes and must not make
      the customer wait for their next session.
    * secret_mints > 0 -- the browser actually connected. Starting a session
      and closing the tab before entering the room must not lock the
      package: nothing was spent and nothing is running.
    * updated_at within the session's own hard cut -- the reaper's staleness
      notion, reused rather than reinvented. The window is the hard cut
      because an interview cannot outlive it, so a crashed browser releases
      the lock when the session it was running would have ended anyway.
      A row with no clock (pre-lifecycle) is never live, exactly as the
      reaper treats it.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=hard_cut_minutes)
    for row in rows:
        if row.status != "planned" or row.secret_mints < 1:
            continue
        if row.updated_at is None:
            continue
        if datetime.fromisoformat(row.updated_at) < cutoff:
            continue
        if row.last_heartbeat_at is not None and heartbeat_stale_after_s is not None:
            heartbeat_cutoff = datetime.now(UTC) - timedelta(seconds=heartbeat_stale_after_s)
            if datetime.fromisoformat(row.last_heartbeat_at) < heartbeat_cutoff:
                continue
        return row
    return None


def stopped_reporting(
    row: SessionRow, hard_cut_minutes: float, heartbeat_stale_after_s: float
) -> bool:
    """Whether a heartbeat-aware live row may be reclaimed now."""
    if (
        row.status != "planned"
        or row.secret_mints < 1
        or row.updated_at is None
        or row.last_heartbeat_at is None
    ):
        return False
    hard_cut = datetime.now(UTC) - timedelta(minutes=hard_cut_minutes)
    heartbeat_cut = datetime.now(UTC) - timedelta(seconds=heartbeat_stale_after_s)
    return (
        datetime.fromisoformat(row.updated_at) >= hard_cut
        and datetime.fromisoformat(row.last_heartbeat_at) < heartbeat_cut
    )


def _empty_profile() -> CandidateProfile:
    """Fallback when the package has no stored candidate profile."""
    return CandidateProfile(
        name=None,
        headline=None,
        years_experience=None,
        roles=[],
        skills=[],
        achievements=[],
    )


def _is_locked_standard(package: PackageRow) -> bool:
    """A standard package nobody has paid for or comped (DECISIONS 060).

    It exposes no sessions at all -- the free trial session retired with the
    quick interview that replaced it -- so every door into a live room reads
    this, not just create_session.
    """
    return (package.kind == "standard"
            and package.paid_at is None
            and package.comped_at is None)


def _room_is_closed(package: PackageRow) -> bool:
    """No live room may open on this package, whatever a session row says.

    The two states create_session refuses at the front door, read together
    because the mint is the same door: locked (409 package-locked) and past
    the paid window (410 package-expired, resumes included). A "planned" row
    created minutes before the window closed outlives it, and the mint is
    what actually buys the OpenAI minutes -- so an expiry the front door
    enforces and this one does not is a paid-and-lapsed package still
    opening rooms, up to the mint cap, on every surviving row.

    The cost is a reconnect lost when a window closes mid-interview. That
    session's upload and complete stay open (finishing is never gated), and
    create_session would refuse a fresh start at the same instant anyway.
    """
    return _is_locked_standard(package) or is_expired(package)


def _session_response(row: SessionRow, package: PackageRow) -> dict:
    """The POST /api/sessions payload for a session row (new or existing).

    Callers guarantee row.session_plan is present, and package.rubric for a
    standard package: a session row is only ever created for a "ready"
    package, with its plan. A quick package has no rubric by design and
    carries its company/role instead.
    """
    profile = package.candidate_profile
    if profile is None:
        profile = _empty_profile()
    instructions = build_interviewer_instructions(
        row.session_plan, package.rubric, profile,
        company=package.quick_company, role=package.quick_role,
    )
    return {
        "session_id": row.id,
        "index": row.index,
        "package_kind": package.kind,
        "session_plan": row.session_plan.model_dump(mode="json"),
        "interviewer_instructions": instructions,
    }


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()

    # Unpacked once so the route bodies below stay exactly what they were
    # inside the create_app closure -- this split must not change behaviour.
    db = deps.db
    storage = deps.storage
    client = deps.client
    limits = deps.limits
    session_create_limiter = deps.session_create_limiter
    complete_limiter = deps.complete_limiter
    resume_attempts = deps.resume_attempts
    score_attempts = deps.score_attempts

    @router.get("/sessions/{session_id}/coaching", response_model=CoachingResponse)
    def get_coaching(session_id: str):
        try:
            return CoachingResponse(
                session_id=session_id,
                paraphrases=db.get_session_paraphrases(session_id),
                insights=db.get_session_insights(session_id),
                marks=db.get_paraphrase_marks(session_id),
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc

    @router.patch("/sessions/{session_id}/coaching/marks", response_model=ParaphraseMarks)
    def set_coaching_marks(session_id: str, body: SetCoachingMarkRequest):
        try:
            return db.set_paraphrase_mark(session_id, body.turn_index, body.mark)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc

    # The concurrent-session lock's window (F-38). Sourced from the
    # session's own hard cut rather than a new knob: an interview cannot
    # run longer than that, so neither can the lock.
    session_hard_cut_minutes = load_product_config().session.hard_cut_minutes
    heartbeat_stale_after_s = load_product_config().session.heartbeat_stale_after_s
    quick_budget_minutes = load_product_config().session.quick_budget_minutes

    @router.post("/sessions")
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
            return rate_limited("session-start")
        if is_expired(package):
            return JSONResponse(
                status_code=410,
                content={
                    "error": (
                        "package expired: the 30-day session window has "
                        "ended — reports and replays stay available"
                    ),
                    "code": "package-expired",
                },
            )
        if _is_locked_standard(package):
            return JSONResponse(
                status_code=409,
                content={
                    "error": "this package has no free sessions — unlock it to interview",
                    "code": "package-locked",
                },
            )
        existing = db.list_sessions(body.package_id)
        # F-38: one live session per package. Two tabs otherwise both get a
        # session and both record, and the recording key is derived from the
        # session index -- so one upload silently overwrites the other and
        # the report is scored against whichever audio survived.
        in_progress = live_session(existing, session_hard_cut_minutes, heartbeat_stale_after_s)
        if in_progress is not None:
            return JSONResponse(
                status_code=409,
                content={
                    "error": (
                        "a session for this package is already in "
                        "progress — finish it, or wait for it to time "
                        "out before starting another"
                    ),
                    "code": "session-in-progress",
                    "session_id": in_progress.id,
                },
            )
        retriable = sorted(
            (row for row in existing if row.status in RETRIABLE_STATUSES),
            key=lambda row: row.index,
        )
        for row in retriable:
            # No abandoned special case: an abandoned row rides the counted
            # branch below like failed/insufficient (quota.py explains why a
            # free abandoned resume would uncap the mint bound), and
            # rearm_session there is what flips it back to "planned".
            if row.status not in RESUME_COUNTED_STATUSES:
                # A planned row never ran: resuming it is free, always.
                return _session_response(row, package)
            if resume_attempts.bump(row.id) <= limits.resume_attempt_cap:
                # Re-arm the row before handing it back. "planned" is what
                # every room guard means by "a browser may interview this":
                # the mint (F-66), the heartbeat, and the F-38 live lock all
                # read exactly that status. A resume that left the row
                # "failed"/"insufficient" returned a session id whose room
                # then refused to open, so the slot F-04 preserves could
                # never be spent -- the customer's only door led back to the
                # screen it came from. rearm_session (not a bare status
                # flip) also resets the attempt-scoped clocks: the dead
                # attempt's secret_mints and heartbeat otherwise make the
                # fresh row read as in-progress or reclaimable for up to
                # the whole hard cut, and keep charging new attempts
                # against the old attempt's mint spend.
                db.rearm_session(row.id)
                return _session_response(db.get_session(row.id), package)
            # Past the cap: retire the row and spend its slot, so the answer
            # below is honestly "next session" or "exhausted" — never an
            # endless retry loop on a session that keeps dying (F-30).
            db.set_session_status(row.id, TERMINAL_STATUS)
            db.touch_updated_at("session", row.id)
            logger.info(
                "session %s retired after %d resume attempts",
                row.id,
                limits.resume_attempt_cap,
            )
        if retriable:
            existing = db.list_sessions(body.package_id)
        total = effective_total_sessions(package)
        if sessions_used(existing) >= total:
            used_line = (
                "the included session is used" if total == 1 else f"all {total} sessions used"
            )
            return JSONResponse(
                status_code=409,
                content={
                    "error": f"package exhausted: {used_line}",
                    "code": "package-exhausted",
                },
            )
        if package.status != "ready" or (
            package.kind == "standard" and package.rubric is None
        ):
            return JSONResponse(
                status_code=409,
                content={
                    "error": (f"package status is {package.status!r}; sessions need 'ready'"),
                    "code": "package-not-ready",
                },
            )
        next_index = max((row.index for row in existing), default=0) + 1
        if package.kind == "quick":
            plan = plan_quick_session(
                package.quick_company, package.quick_role,
                budget_minutes=quick_budget_minutes,
            )
        else:
            plan = plan_baseline_session(
                package.rubric,
                session_index=next_index,
                history=existing,
                profile=package.candidate_profile,
            )
        row = db.create_session(body.package_id, next_index, plan)
        db.touch_updated_at("session", row.id)
        return _session_response(row, package)

    @router.post("/sessions/{session_id}/complete", status_code=202)
    def complete_session(
        session_id: str, body: CompleteSessionRequest, background_tasks: BackgroundTasks
    ):
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        if row.status == "quick_done":
            # Terminal, and never scored: a replayed End (double tap, or the
            # browser retrying its own request) must not tell the customer
            # their unscored five minutes were scored.
            return JSONResponse(
                status_code=409,
                content={
                    "error": "this quick interview is already finished",
                    "code": "quick-already-done",
                },
            )
        if row.status in ("scoring", "scored"):
            # Scoring is the expensive paid trigger; a session is scored at
            # most once. "planned" starts a run and "failed" allows a retry.
            return JSONResponse(
                status_code=409,
                content={"error": f"session is already {row.status}; it cannot be re-scored"},
            )
        if row.status == TERMINAL_STATUS:
            return JSONResponse(
                status_code=409,
                content={
                    "error": (
                        "this session was retired after repeated "
                        "attempts and cannot be scored again"
                    ),
                    "code": "session-terminal",
                },
            )
        package = db.get_package(row.package_id)
        # Ahead of the limiter, as it was when pydantic enforced it: the
        # field became optional so a quick session can complete with an
        # empty body, and a request that cannot be honoured must not first
        # spend a slice of the customer's completion budget.
        if package.kind != "quick" and body.audio_path is None:
            return JSONResponse(
                status_code=422,
                content={"error": "audio_path is required for a standard session"},
            )
        if not complete_limiter.hit(package.user_id or row.package_id):
            return rate_limited("scoring")
        if package.kind == "quick":
            db.set_session_status(session_id, "quick_done")
            db.touch_updated_at("session", session_id)
            return {"session_id": session_id, "status": "quick_done"}
        if score_attempts.bump(session_id) > limits.score_attempt_cap:
            # The scoring pipeline keeps dying on this recording: burning
            # more model spend on it will not change the outcome, so the
            # row is retired and its slot spent (F-30).
            db.set_session_status(session_id, TERMINAL_STATUS)
            db.touch_updated_at("session", session_id)
            logger.info(
                "session %s retired after %d scoring attempts",
                session_id,
                limits.score_attempt_cap,
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": (
                        "scoring attempt limit reached for this session — the slot is closed"
                    ),
                    "code": "score-attempt-cap",
                },
            )
        db.set_session_status(session_id, "scoring", audio_path=body.audio_path)
        db.touch_updated_at("session", session_id)
        background_tasks.add_task(score_session_job, session_id, db, storage, client)
        return {"session_id": session_id, "status": "scoring"}

    @router.post("/sessions/{session_id}/secret-mint")
    def mint_session_secret(session_id: str):
        """Count one realtime-secret mint against the session's cap.

        DB-backed (migration 005): the count survives worker restarts, so
        this is the durable per-session bound on OpenAI Realtime spend. The
        web's realtime-secret route calls this BEFORE minting and refuses
        on 429.
        """
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        # Same guard as heartbeat: mint is the door into the live room, and a
        # session past "planned" can only produce heartbeats the server will
        # 409 anyway (F-66). Refused before the counter moves, so a doomed
        # session burns no mint-cap headroom and leaves the F-38 lock window
        # untouched.
        if row.status != "planned":
            return JSONResponse(
                status_code=409,
                content={"error": "session is not running", "code": "session-not-live"},
            )
        # DECISIONS 060: a locked standard package has no session to spend,
        # and this is the door create_session's package-locked refusal cannot
        # close by itself. Every account that ever started a trial session
        # still owns a "planned" row, and the room reaches OpenAI through the
        # mint -- a reloaded room tab would keep buying realtime minutes on a
        # package that will never be paid for. An expired window is the same
        # door from the other side (_room_is_closed).
        #
        # "session-not-live" deliberately, not a new code: the web blocks the
        # room on 429 and on THIS 409 code, and lets every other 409 fall
        # through to its counter-outage path, which mints anyway
        # (apps/web/app/api/realtime-secret/route.ts). A missing package row
        # takes the same answer for the same reason: raising here would be a
        # 500, and the web reads a 500 as a counter outage and mints too.
        try:
            package = db.get_package(row.package_id)
        except KeyError:
            logger.warning("session %s has no package row; mint refused", session_id)
            package = None
        if package is None or _room_is_closed(package):
            return JSONResponse(
                status_code=409,
                content={"error": "session is not running", "code": "session-not-live"},
            )
        count = db.increment_secret_mints(session_id)
        # The mint is the moment the browser joins the room, so it is what
        # the F-38 lock window should be measured from -- not the moment the
        # row was created, which may be long before the customer starts.
        db.touch_updated_at("session", session_id)
        if count > limits.secret_mint_cap:
            return JSONResponse(
                status_code=429,
                content={
                    "error": ("this session has reached its live-interview connection limit"),
                    "code": "mint-cap",
                    "secret_mints": count,
                },
            )
        return {"session_id": session_id, "secret_mints": count}

    @router.post("/sessions/{session_id}/heartbeat")
    def heartbeat_session(session_id: str):
        try:
            row = db.get_session(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        if row.status != "planned":
            return JSONResponse(
                status_code=409,
                content={"error": "session is not running", "code": "session-not-live"},
            )
        db.touch_session_heartbeat(session_id)
        return {"session_id": session_id, "status": "alive"}

    @router.post("/sessions/{session_id}/reclaim")
    def reclaim_session(session_id: str, body: ReclaimSessionRequest):
        try:
            row = db.get_session(session_id)
            package = db.get_package(body.package_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="session not found") from exc
        if row.package_id != package.id or package.user_id != body.user_id:
            raise HTTPException(status_code=404, detail="session not found")
        if row.status == "abandoned":
            return {"session_id": session_id, "status": "abandoned"}
        if not stopped_reporting(row, session_hard_cut_minutes, heartbeat_stale_after_s):
            return JSONResponse(
                status_code=409,
                content={
                    "error": "session is not eligible for reclaim",
                    "code": "session-not-reclaimable",
                },
            )
        if not db.reclaim_session(session_id, heartbeat_stale_after_s):
            return JSONResponse(
                status_code=409,
                content={
                    "error": "session reported alive before reclaim completed",
                    "code": "session-not-reclaimable",
                },
            )
        return {"session_id": session_id, "status": "abandoned"}

    @router.get("/sessions/{session_id}/transcript")
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
                None if segments is None else [seg.model_dump(mode="json") for seg in segments]
            ),
        }

    @router.get("/sessions/{session_id}")
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
        if row.session_plan is not None and (
            package.rubric is not None or package.kind == "quick"
        ):
            profile = package.candidate_profile
            if profile is None:
                profile = _empty_profile()
            instructions = build_interviewer_instructions(
                row.session_plan, package.rubric, profile,
                company=package.quick_company, role=package.quick_role,
            )
        payload = row.model_dump(mode="json")
        payload["package_kind"] = package.kind
        payload["interviewer_instructions"] = instructions
        return payload

    return router
