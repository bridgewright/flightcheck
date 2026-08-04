"""Package/session persistence: row models, the Database protocol, and the
Supabase adapter.

jsonb <-> pydantic mapping happens only at this edge: model_dump(mode="json")
on write, model_validate on read. Missing rows raise KeyError in every
implementation (FakeDatabase in tests/fakes.py mirrors the real adapter), so
callers handle one exception type regardless of backend.
"""
from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol, runtime_checkable

from postgrest.exceptions import APIError as PostgrestAPIError
from pydantic import BaseModel, ConfigDict
from supabase import Client, create_client

from scorer.env import load_env, require_key
from scorer.schemas import (
    CandidateProfile,
    Rubric,
    SessionPlan,
    SessionReport,
    TranscriptSegment,
)

# Explicit column list for every hot session read (get_session,
# list_sessions). The transcript column is deliberately absent: transcripts
# run 25-60KB per session and must never ride the dashboard/status polls.
# get_transcript is the only reader of that column, and it reads nothing else.
logger = logging.getLogger(__name__)

# How long a job description may be and still be looked up by equality. The
# filter travels in a URI, so this is a URI-length budget, not a product
# rule: 8KB of JD leaves room for the rest of the query inside the 16KB most
# servers accept. Past it the compile just runs.
_REUSE_LOOKUP_MAX_CHARS = 8_000

SESSION_COLUMNS = (
    "id,package_id,index,status,scoring_stage,session_plan,"
    "audio_path,report,created_at,updated_at,secret_mints,last_heartbeat_at,"
    # Migration 006. The web guard (lib/session-capability.ts) fails closed on
    # anything it cannot read and treats both nulls as "not yet", so selecting
    # them changes nothing until a value exists -- but without selecting them
    # the guard could never see a revocation, which made it enforcement with
    # no signal. Revocation is now live end to end: set token_revoked_at and
    # the next room entry and secret mint are refused.
    "access_token_expires_at,token_revoked_at"
)

# Paid-package policy constants (v0.5): $49 unlocks the trial package to 6
# sessions for 30 days from payment. The web mirrors these in lib/pricing.ts.
PAID_TOTAL_SESSIONS = 6
EXPIRY_DAYS = 30


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def expires_at_from(paid_at: str) -> str:
    """Expiry timestamp EXPIRY_DAYS after paid_at (ISO in, ISO out).

    Accepts both '+00:00' offsets and the 'Z' suffix Polar timestamps use.
    """
    return (datetime.fromisoformat(paid_at)
            + timedelta(days=EXPIRY_DAYS)).isoformat()


def _stale_cutoff_iso(older_than_s: float) -> str:
    """The updated_at cutoff for stale-row listing: now - older_than_s."""
    return (datetime.now(UTC)
            - timedelta(seconds=older_than_s)).isoformat()


def _table_for(kind: Literal["package", "session"]) -> str:
    """touch_updated_at's kind -> table name; unknown kinds raise ValueError
    in every backend so a typo fails loudly instead of touching nothing."""
    tables = {"package": "packages", "session": "sessions"}
    if kind not in tables:
        raise ValueError(f"unknown touch kind: {kind!r}")
    return tables[kind]


# delete_rows' kind -> table name. Deliberately a SECOND map rather than a
# widening of _table_for: touch_updated_at writes an updated_at column that
# orders does not have, so the two vocabularies are not interchangeable.
DeletableKind = Literal["package", "session", "order"]
_DELETE_TABLES: dict[str, str] = {
    "package": "packages", "session": "sessions", "order": "orders",
}


def _delete_table_for(kind: str) -> str:
    if kind not in _DELETE_TABLES:
        raise ValueError(f"unknown delete kind: {kind!r}")
    return _DELETE_TABLES[kind]


class PackageRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    access_token: str
    status: str                       # "compiling" -> "ready" | "failed"
    jd_text: str
    # The URL the customer pasted, when they pasted one rather than the text.
    # It is the only domain this product can honestly associate with the
    # employer (F-54), and it is null far more often than not.
    jd_url: str | None = None
    candidate_profile: CandidateProfile | None
    rubric: Rubric | None
    user_id: str | None = None
    total_sessions: int = 6
    # v0.5 payments columns (migration 005). Defaults keep every row stored
    # before the migration validating. is_trial marks the first package per
    # account and NEVER flips back on payment — paid state is "paid_at is
    # not None"; expires_at = paid_at + EXPIRY_DAYS; order_id links the
    # provisioning order; updated_at feeds the stuck-state reaper.
    is_trial: bool = False
    paid_at: str | None = None
    expires_at: str | None = None
    order_id: str | None = None
    updated_at: str | None = None
    # Migration 008. Comped access: the package exposes its full session count
    # with no order behind it. Deliberately NOT paid_at, which is the money
    # anchor -- a comp written there would become revenue in every query that
    # counts paid packages, including the published usage metrics.
    comped_at: str | None = None


class SessionRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    package_id: str
    index: int
    # "planned" -> "scoring" -> "scored" | "failed" | "insufficient".
    # "insufficient" (F-04) is terminal like "failed" and just as retriable:
    # the slot is preserved and create_session resumes the row.
    status: str
    scoring_stage: str | None = None  # coarse progress while "scoring", else None
    session_plan: SessionPlan | None
    audio_path: str | None
    report: SessionReport | None
    created_at: str | None = None
    # v0.5 (migration 005): updated_at feeds the stuck-state reaper;
    # secret_mints counts realtime-secret mints for the per-session cap.
    updated_at: str | None = None
    secret_mints: int = 0
    # v0.8 (migration 007): NULL means this session predates heartbeats and
    # retains the hard-cut-only lock behavior.
    last_heartbeat_at: str | None = None
    # v0.6 (migration 006): capability-token lifetime for the room's package
    # access_token. Both NULL by default -- a null expiry means "no expiry",
    # which is the pre-006 behaviour, and a null revocation means "never
    # revoked". Declared here so the seam is typed; the hot session read
    # (SESSION_COLUMNS) fetches them as of v0.6. Both stay None until
    # something sets them: revocation is operator-driven, and no automatic
    # expiry is minted yet (see DECISIONS on the capability window).
    access_token_expires_at: str | None = None
    token_revoked_at: str | None = None


class OrderRow(BaseModel):
    """One Polar order (migration 005). id/created_at are DB-generated:
    build the row with both None, insert_order returns them filled.
    polar_order_id is UNIQUE — the webhook's idempotency key."""

    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    user_id: str
    package_id: str
    polar_order_id: str
    polar_checkout_id: str | None = None
    amount_minor: int | None = None   # e.g. 4900 for $49.00
    currency: str | None = None
    status: str | None = None
    created_at: str | None = None


@runtime_checkable
class Database(Protocol):
    """Persistence seam the pipeline consumes (Task 12); SupabaseDatabase
    implements it, FakeDatabase (tests/fakes.py) fakes it."""

    def create_package(self, jd_text: str, jd_url: str | None,
                       user_id: str | None = None,
                       is_trial: bool = False) -> PackageRow:
        """Insert a "compiling" package. user_id binds the row to the creating
        account at birth (auth-gated /new); None keeps the legacy unbound
        shape for callers that still claim by token. is_trial marks the
        account's FIRST package (Track C computes it at the create
        chokepoint; it never flips later -- paid state is paid_at)."""
        ...

    def get_package(self, package_id: str) -> PackageRow:
        ...

    def get_package_by_token(self, access_token: str) -> PackageRow:
        ...

    def list_packages_by_user(self, user_id: str) -> list[PackageRow]:
        """A user's packages, newest first; [] when the user has none."""
        ...

    def set_package_profile(self, package_id: str, profile: CandidateProfile) -> None:
        ...

    def set_package_rubric(self, package_id: str, rubric: Rubric | None,
                           status: str) -> None:
        """rubric=None marks a failed compile: status update only, no rubric write."""
        ...

    def find_ready_rubric_by_jd(
        self, jd_text: str, user_id: str | None
    ) -> tuple[CandidateProfile | None, Rubric] | None:
        """Newest "ready" package of THIS user with EXACTLY this jd_text, as
        (candidate_profile, rubric); None when no such package exists.
        Rubric reuse: identical intake inputs compile to an equivalent
        rubric, so a recompile is pure spend.

        Same-account only, always: the returned candidate_profile is the
        source account's own resume data, so a cross-account match would hand
        one customer another customer's name. user_id=None has no account to
        match and therefore never reuses."""
        ...

    def create_session(self, package_id: str, index: int,
                       plan: SessionPlan) -> SessionRow:
        ...

    def get_session(self, session_id: str) -> SessionRow:
        ...

    def list_sessions(self, package_id: str) -> list[SessionRow]:
        """All sessions of a package, ascending index; [] when none exist
        (an unknown package_id is also [] -- a filter, not a lookup)."""
        ...

    def set_session_status(self, session_id: str, status: str,
                           audio_path: str | None = None) -> None:
        """Terminal statuses ("scored"/"failed"/"insufficient") also clear
        scoring_stage to None in the same write -- a finished row never
        keeps a stale stage."""
        ...

    def set_scoring_stage(self, session_id: str, stage: str) -> None:
        """Coarse progress marker while status == "scoring" ("download" ->
        "transcribe" -> "delivery-metrics" -> "content-judge" ->
        "delivery-judge" -> "compile"); terminal status writes clear it."""
        ...

    def save_report(self, session_id: str, report: SessionReport) -> None:
        ...

    def save_transcript(self, session_id: str,
                        segments: list[TranscriptSegment]) -> None:
        """Persist the verbatim transcript on the session row. Written right
        after the transcribe stage so a later judge failure still leaves the
        transcript on the failed row. Unknown session ids raise KeyError."""
        ...

    def get_transcript(self, session_id: str) -> list[TranscriptSegment] | None:
        """The stored transcript, or None when the session exists but has no
        transcript (sessions scored before transcripts were persisted).
        Unknown session ids raise KeyError like every other lookup."""
        ...

    # ------------------------------------------------ v0.5 payments surface

    def insert_order(self, order: OrderRow) -> OrderRow:
        """Insert an order and return it with DB-generated id/created_at
        filled. polar_order_id is UNIQUE: a duplicate insert raises (the
        adapter surfaces postgrest's error, the fake ValueError) — callers
        guard with find_order_by_polar_id first."""
        ...

    def find_order_by_polar_id(self, polar_order_id: str) -> OrderRow | None:
        """The order provisioned from this Polar order id, or None. An
        existence probe (webhook idempotency), so absence is None, not
        KeyError."""
        ...

    def list_orders_for_user(self, user_id: str) -> list[OrderRow]:
        """A user's orders, newest first; [] when the user has none."""
        ...

    def set_package_paid(self, package_id: str, order_id: str,
                         paid_at: str) -> None:
        """Flip a package to paid: paid_at, expires_at = paid_at +
        EXPIRY_DAYS, order_id, total_sessions = PAID_TOTAL_SESSIONS (and an
        updated_at touch) in one write. Idempotent, first write wins: a
        package whose paid_at is already set is left untouched, so webhook
        replays can never move the expiry window. is_trial is NOT cleared —
        paid state is "paid_at is not None". Unknown ids raise KeyError."""
        ...

    def set_package_comped(self, package_id: str, comped_at: str) -> None:
        """Grant comped access: comped_at and total_sessions =
        PAID_TOTAL_SESSIONS, with an updated_at touch. First write wins, so a
        second grant cannot re-stamp the date. Never touches paid_at, order_id
        or expires_at: a comp is not a payment and gets no 30-day window.
        Unknown ids raise KeyError."""
        ...

    def touch_updated_at(self, kind: Literal["package", "session"],
                         id: str) -> None:
        """Stamp updated_at = now (UTC ISO) on a package or session row.
        Track C calls this on every status write so the stuck-state reaper
        can spot stalled rows. Unknown kind raises ValueError; unknown id
        raises KeyError."""
        ...

    def increment_secret_mints(self, session_id: str) -> int:
        """Add one realtime-secret mint to the session and return the NEW
        count (a NULL pre-migration column counts as zero). Read-then-write,
        not atomic: mint calls for one session arrive from one user's room,
        so the cap tolerates the benign race. Unknown ids raise KeyError."""
        ...

    def list_stale_packages(self, status: str,
                            older_than_s: float) -> list[PackageRow]:
        """Packages in `status` whose updated_at is older than now -
        older_than_s. Rows with updated_at NULL are excluded (SQL lt()
        semantics); every post-batch status write touches updated_at, so
        only pre-batch rows can hide that way."""
        ...

    def list_stale_sessions(self, status: str,
                            older_than_s: float) -> list[SessionRow]:
        """Sessions in `status` whose updated_at is older than now -
        older_than_s; same NULL-exclusion contract as list_stale_packages."""
        ...

    def reset_package_for_compile(self, package_id: str) -> None:
        """Return a package to "compiling" (+ updated_at touch) so the
        compile can be retried. A pure state reset: the caller (Track C's
        retry endpoint) owns the only-when-failed guard and the recompile
        dispatch. Unknown ids raise KeyError."""
        ...

    # ------------------------------------------------ v0.6 account deletion

    def delete_rows(self, kind: DeletableKind, ids: list[str]) -> int:
        """Hard-delete rows by explicit id; return how many actually went.

        The one destructive read-nothing-first operation on this protocol,
        and deliberately the narrowest shape that can serve account deletion
        (api/deletion.py is its only caller): it takes an id list the caller
        already collected, never a filter, so no bug upstream can widen it
        into "delete everyone".

        Idempotent on purpose -- ids that are already gone are not an error,
        they are the desired end state. That is what lets a deletion that
        failed halfway be retried to completion instead of wedging. An empty
        list is a no-op returning 0 (no round trip); unknown kinds raise
        ValueError. Reports and transcripts are columns on sessions and go
        with them.
        """

    def touch_session_heartbeat(self, session_id: str) -> None:
        """Stamp only last_heartbeat_at for a planned session."""

    def reclaim_session(self, session_id: str, older_than_s: float) -> bool:
        """Atomically abandon a planned row only if its heartbeat is stale."""
    # -------------------------------------------------- v0.6 usage metrics

    def list_recent_packages(self, limit: int) -> list[PackageRow]:
        """The newest `limit` packages across every account, newest first.

        Bounded by construction: F-13 aggregates a recent window, and an
        unbounded scan would quietly become a full-table read as the
        product grows. The bound is config (metrics.usage_scan_limit), so
        widening the window is not a code change."""
        ...

    def list_recent_sessions(self, limit: int) -> list[SessionRow]:
        """The newest `limit` sessions across every package, newest first;
        same bound and the same reason."""
        ...


def create_supabase_client() -> Client:
    """Supabase client from services/scorer/.env (server-side service-role key).

    Composition contract: Task 12's main() calls this exactly ONCE and passes
    the same client to both SupabaseDatabase(client) and
    SupabaseStorage(client). Never log these values.
    """
    load_env()
    return create_client(require_key("SUPABASE_URL"),
                         require_key("SUPABASE_SERVICE_ROLE_KEY"))


def _to_package_row(data: dict) -> PackageRow:
    """packages row dict (PostgREST) -> PackageRow; jsonb -> pydantic on read."""
    return PackageRow(
        id=data["id"],
        access_token=data["access_token"],
        status=data["status"],
        jd_text=data["jd_text"] or "",
        jd_url=data.get("jd_url"),
        candidate_profile=(
            CandidateProfile.model_validate(data["candidate_profile"])
            if data.get("candidate_profile") is not None
            else None
        ),
        rubric=(
            Rubric.model_validate(data["rubric"])
            if data.get("rubric") is not None
            else None
        ),
        user_id=data.get("user_id"),
        total_sessions=data.get("total_sessions", 6),
        is_trial=data.get("is_trial") or False,
        paid_at=data.get("paid_at"),
        # Migration 008. Read explicitly like every other column: this
        # converter names its fields, so a column added to the table and to
        # the model but not to this list arrives as None forever. That is
        # exactly what happened when comped access first shipped -- the write
        # worked, the DB row was right, both test suites were green, and the
        # screen said "0 of 1" because every read dropped the value here.
        comped_at=data.get("comped_at"),
        expires_at=data.get("expires_at"),
        order_id=data.get("order_id"),
        updated_at=data.get("updated_at"),
    )


def _to_session_row(data: dict) -> SessionRow:
    """sessions row dict (PostgREST) -> SessionRow; jsonb -> pydantic on read."""
    return SessionRow(
        id=data["id"],
        package_id=data["package_id"],
        index=data["index"],
        status=data["status"],
        scoring_stage=data.get("scoring_stage"),
        session_plan=(
            SessionPlan.model_validate(data["session_plan"])
            if data.get("session_plan") is not None
            else None
        ),
        audio_path=data.get("audio_path"),
        created_at=data.get("created_at"),
        report=(
            SessionReport.model_validate(data["report"])
            if data.get("report") is not None
            else None
        ),
        updated_at=data.get("updated_at"),
        secret_mints=data.get("secret_mints") or 0,
        last_heartbeat_at=data.get("last_heartbeat_at"),
    )


def _to_order_row(data: dict) -> OrderRow:
    """orders row dict (PostgREST) -> OrderRow."""
    return OrderRow(
        id=data["id"],
        user_id=data["user_id"],
        package_id=data["package_id"],
        polar_order_id=data["polar_order_id"],
        polar_checkout_id=data.get("polar_checkout_id"),
        amount_minor=data.get("amount_minor"),
        currency=data.get("currency"),
        status=data.get("status"),
        created_at=data.get("created_at"),
    )


class SupabaseDatabase:
    """Database implementation over supabase-py (PostgREST under the hood)."""

    def __init__(self, client: Client):
        self._client = client

    def create_package(self, jd_text: str, jd_url: str | None,
                       user_id: str | None = None,
                       is_trial: bool = False) -> PackageRow:
        payload = {
            "access_token": secrets.token_urlsafe(24),
            "status": "compiling",
            "jd_text": jd_text,
            "jd_url": jd_url,
            "user_id": user_id,
            "is_trial": is_trial,
        }
        data = self._client.table("packages").insert(payload).execute().data
        return _to_package_row(data[0])

    def get_package(self, package_id: str) -> PackageRow:
        data = (self._client.table("packages").select("*")
                .eq("id", package_id).execute().data)
        if not data:
            raise KeyError(package_id)
        return _to_package_row(data[0])

    def get_package_by_token(self, access_token: str) -> PackageRow:
        data = (self._client.table("packages").select("*")
                .eq("access_token", access_token).execute().data)
        if not data:
            raise KeyError(access_token)
        return _to_package_row(data[0])

    def list_packages_by_user(self, user_id: str) -> list[PackageRow]:
        data = (self._client.table("packages").select("*")
                .eq("user_id", user_id).order("created_at", desc=True)
                .execute().data)
        return [_to_package_row(row) for row in data]

    def set_package_profile(self, package_id: str, profile: CandidateProfile) -> None:
        data = (self._client.table("packages")
                .update({"candidate_profile": profile.model_dump(mode="json")})
                .eq("id", package_id).execute().data)
        if not data:
            raise KeyError(package_id)

    def set_package_rubric(self, package_id: str, rubric: Rubric | None,
                           status: str) -> None:
        # rubric=None marks a failed compile: status update only, no rubric
        # write -- the failure handler must never overwrite stored data (and
        # must never crash on None.model_dump).
        payload: dict[str, object] = {"status": status}
        if rubric is not None:
            payload["rubric"] = rubric.model_dump(mode="json")
        data = (self._client.table("packages").update(payload)
                .eq("id", package_id).execute().data)
        if not data:
            raise KeyError(package_id)

    def find_ready_rubric_by_jd(
        self, jd_text: str, user_id: str | None
    ) -> tuple[CandidateProfile | None, Rubric] | None:
        # Never let user_id=None reach PostgREST: eq("user_id", None) filters
        # on NULL and would match every unowned row instead of matching nothing.
        if user_id is None:
            return None
        # PostgREST takes filters in the query string, so this equality puts
        # the WHOLE job description in a URI. A long posting (a fetched
        # careers page runs to tens of kilobytes) overruns what the server
        # accepts and comes back 400 "JSON could not be generated" -- observed
        # in production 2026-08-04, where it aborted create_package AFTER the
        # row existed and left the package compiling forever.
        #
        # This lookup is an optimization: on a miss the compile simply runs.
        # So a long JD skips it rather than risking the request, and any
        # failure below is swallowed for the same reason.
        if len(jd_text) > _REUSE_LOOKUP_MAX_CHARS:
            return None
        try:
            data = (self._client.table("packages").select("*")
                    .eq("jd_text", jd_text).eq("user_id", user_id)
                    .eq("status", "ready")
                    .order("created_at", desc=True).limit(1).execute().data)
        except PostgrestAPIError:
            logger.warning(
                "rubric reuse lookup failed; compiling instead of reusing")
            return None
        if not data:
            return None
        row = _to_package_row(data[0])
        if row.rubric is None:
            return None
        return (row.candidate_profile, row.rubric)

    def create_session(self, package_id: str, index: int,
                       plan: SessionPlan) -> SessionRow:
        payload = {
            "package_id": package_id,
            "index": index,
            "status": "planned",
            "session_plan": plan.model_dump(mode="json"),
        }
        data = self._client.table("sessions").insert(payload).execute().data
        return _to_session_row(data[0])

    def get_session(self, session_id: str) -> SessionRow:
        data = (self._client.table("sessions").select(SESSION_COLUMNS)
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)
        return _to_session_row(data[0])

    def list_sessions(self, package_id: str) -> list[SessionRow]:
        query = (self._client.table("sessions").select(SESSION_COLUMNS)
                 .eq("package_id", package_id))
        if hasattr(query, "order"):
            query = query.order("index")
        data = query.execute().data
        # Sorted here (not in SQL) so every backend orders identically.
        return sorted((_to_session_row(d) for d in data), key=lambda r: r.index)

    def set_session_status(self, session_id: str, status: str,
                           audio_path: str | None = None) -> None:
        payload: dict[str, str | None] = {"status": status}
        if status in ("scored", "failed", "insufficient"):
            # Clearing rides the SAME update as the terminal status write so
            # a finished row can never be observed with a stale stage.
            payload["scoring_stage"] = None
        if audio_path is not None:
            payload["audio_path"] = audio_path
        data = (self._client.table("sessions").update(payload)
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)

    def set_scoring_stage(self, session_id: str, stage: str) -> None:
        data = (self._client.table("sessions").update({"scoring_stage": stage})
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)

    def save_report(self, session_id: str, report: SessionReport) -> None:
        # Report + status land in ONE update so "report present" and
        # status=="scored" can never be observed apart; the terminal write
        # also clears scoring_stage (same invariant as set_session_status).
        data = (self._client.table("sessions")
                .update({"report": report.model_dump(mode="json"),
                         "status": "scored", "scoring_stage": None})
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)

    def save_transcript(self, session_id: str,
                        segments: list[TranscriptSegment]) -> None:
        payload = {"transcript": [seg.model_dump(mode="json") for seg in segments]}
        data = (self._client.table("sessions").update(payload)
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)

    def get_transcript(self, session_id: str) -> list[TranscriptSegment] | None:
        # Only the transcript column: this is the one read allowed to carry
        # the 25-60KB payload, and it carries nothing else.
        data = (self._client.table("sessions").select("transcript")
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)
        raw = data[0].get("transcript")
        if raw is None:
            return None
        return [TranscriptSegment.model_validate(item) for item in raw]

    # ------------------------------------------------ v0.5 payments surface

    def insert_order(self, order: OrderRow) -> OrderRow:
        payload = order.model_dump(mode="json")
        for column in ("id", "created_at"):
            # DB-generated defaults: a None value never rides the insert.
            if payload[column] is None:
                payload.pop(column)
        data = self._client.table("orders").insert(payload).execute().data
        return _to_order_row(data[0])

    def find_order_by_polar_id(self, polar_order_id: str) -> OrderRow | None:
        data = (self._client.table("orders").select("*")
                .eq("polar_order_id", polar_order_id).execute().data)
        if not data:
            return None
        return _to_order_row(data[0])

    def list_orders_for_user(self, user_id: str) -> list[OrderRow]:
        data = (self._client.table("orders").select("*")
                .eq("user_id", user_id).order("created_at", desc=True)
                .execute().data)
        return [_to_order_row(row) for row in data]

    def set_package_paid(self, package_id: str, order_id: str,
                         paid_at: str) -> None:
        # First write wins: replayed webhooks must never move the expiry
        # window, so an already-paid package is read and left untouched.
        if self.get_package(package_id).paid_at is not None:
            return
        data = (self._client.table("packages")
                .update({"paid_at": paid_at,
                         "expires_at": expires_at_from(paid_at),
                         "order_id": order_id,
                         "total_sessions": PAID_TOTAL_SESSIONS,
                         "updated_at": _now_iso()})
                .eq("id", package_id).execute().data)
        if not data:
            raise KeyError(package_id)

    def set_package_comped(self, package_id: str, comped_at: str) -> None:
        # First write wins, mirroring set_package_paid: a repeated grant must
        # not re-stamp the date somebody may be reading as "since when".
        if self.get_package(package_id).comped_at is not None:
            return
        data = (self._client.table("packages")
                .update({"comped_at": comped_at,
                         "total_sessions": PAID_TOTAL_SESSIONS,
                         "updated_at": _now_iso()})
                .eq("id", package_id).execute().data)
        if not data:
            raise KeyError(package_id)

    def touch_updated_at(self, kind: Literal["package", "session"],
                         id: str) -> None:
        table = _table_for(kind)
        data = (self._client.table(table)
                .update({"updated_at": _now_iso()})
                .eq("id", id).execute().data)
        if not data:
            raise KeyError(id)

    def increment_secret_mints(self, session_id: str) -> int:
        data = (self._client.table("sessions").select("secret_mints")
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)
        count = (data[0].get("secret_mints") or 0) + 1
        updated = (self._client.table("sessions")
                   .update({"secret_mints": count})
                   .eq("id", session_id).execute().data)
        if not updated:
            raise KeyError(session_id)
        return count

    def touch_session_heartbeat(self, session_id: str) -> None:
        data = (self._client.table("sessions")
                .update({"last_heartbeat_at": _now_iso()})
                .eq("id", session_id).eq("status", "planned")
                .execute().data)
        if not data:
            raise KeyError(session_id)

    def reclaim_session(self, session_id: str, older_than_s: float) -> bool:
        data = (self._client.table("sessions")
                .update({"status": "abandoned"})
                .eq("id", session_id).eq("status", "planned")
                .lt("last_heartbeat_at", _stale_cutoff_iso(older_than_s))
                .execute().data)
        return bool(data)

    def list_stale_packages(self, status: str,
                            older_than_s: float) -> list[PackageRow]:
        data = (self._client.table("packages").select("*")
                .eq("status", status)
                .lt("updated_at", _stale_cutoff_iso(older_than_s))
                .execute().data)
        return [_to_package_row(row) for row in data]

    def list_stale_sessions(self, status: str,
                            older_than_s: float) -> list[SessionRow]:
        data = (self._client.table("sessions").select(SESSION_COLUMNS)
                .eq("status", status)
                .lt("updated_at", _stale_cutoff_iso(older_than_s))
                .execute().data)
        return [_to_session_row(row) for row in data]

    def reset_package_for_compile(self, package_id: str) -> None:
        data = (self._client.table("packages")
                .update({"status": "compiling", "updated_at": _now_iso()})
                .eq("id", package_id).execute().data)
        if not data:
            raise KeyError(package_id)

    # ------------------------------------------------ v0.6 account deletion

    def delete_rows(self, kind: DeletableKind, ids: list[str]) -> int:
        table = _delete_table_for(kind)   # ValueError before any round trip
        if not ids:
            return 0
        # PostgREST returns the deleted representation, so len() is the real
        # count -- ids that were already gone simply do not appear, which is
        # exactly the idempotent contract the protocol promises.
        data = (self._client.table(table).delete()
                .in_("id", list(ids)).execute().data)
        return len(data or [])
    # -------------------------------------------------- v0.6 usage metrics

    def list_recent_packages(self, limit: int) -> list[PackageRow]:
        data = (self._client.table("packages").select("*")
                .order("created_at", desc=True).limit(limit)
                .execute().data)
        return [_to_package_row(row) for row in data]

    def list_recent_sessions(self, limit: int) -> list[SessionRow]:
        data = (self._client.table("sessions").select(SESSION_COLUMNS)
                .order("created_at", desc=True).limit(limit)
                .execute().data)
        return [_to_session_row(row) for row in data]
