"""Package/session persistence: row models, the Database protocol, and the
Supabase adapter.

jsonb <-> pydantic mapping happens only at this edge: model_dump(mode="json")
on write, model_validate on read. Missing rows raise KeyError in every
implementation (FakeDatabase in tests/fakes.py mirrors the real adapter), so
callers handle one exception type regardless of backend.
"""
from __future__ import annotations

import secrets
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict
from supabase import Client, create_client

from scorer.env import load_env, require_key
from scorer.schemas import CandidateProfile, Rubric, SessionPlan, SessionReport


class PackageRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    access_token: str
    status: str                       # "compiling" -> "ready" | "failed"
    jd_text: str
    candidate_profile: CandidateProfile | None
    rubric: Rubric | None
    user_id: str | None = None
    total_sessions: int = 6


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


@runtime_checkable
class Database(Protocol):
    """Persistence seam the pipeline consumes (Task 12); SupabaseDatabase
    implements it, FakeDatabase (tests/fakes.py) fakes it."""

    def create_package(self, jd_text: str, jd_url: str | None) -> PackageRow:
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
        self, jd_text: str
    ) -> tuple[CandidateProfile | None, Rubric] | None:
        """Newest "ready" package with EXACTLY this jd_text, as
        (candidate_profile, rubric); None when no such package exists.
        Rubric reuse: identical intake inputs compile to an equivalent
        rubric, so a recompile is pure spend."""
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
    )


class SupabaseDatabase:
    """Database implementation over supabase-py (PostgREST under the hood)."""

    def __init__(self, client: Client):
        self._client = client

    def create_package(self, jd_text: str, jd_url: str | None) -> PackageRow:
        payload = {
            "access_token": secrets.token_urlsafe(24),
            "status": "compiling",
            "jd_text": jd_text,
            "jd_url": jd_url,
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
        self, jd_text: str
    ) -> tuple[CandidateProfile | None, Rubric] | None:
        data = (self._client.table("packages").select("*")
                .eq("jd_text", jd_text).eq("status", "ready")
                .order("created_at", desc=True).limit(1).execute().data)
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
        data = (self._client.table("sessions").select("*")
                .eq("id", session_id).execute().data)
        if not data:
            raise KeyError(session_id)
        return _to_session_row(data[0])

    def list_sessions(self, package_id: str) -> list[SessionRow]:
        query = (self._client.table("sessions").select("*")
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
