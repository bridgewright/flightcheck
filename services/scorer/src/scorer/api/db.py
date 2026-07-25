"""Package/session persistence: row models and the Database protocol.

jsonb <-> pydantic mapping happens only at this edge: model_dump(mode="json")
on write, model_validate on read. Missing rows raise KeyError in every
implementation (FakeDatabase in tests/fakes.py mirrors the real adapter), so
callers handle one exception type regardless of backend.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict

from scorer.schemas import CandidateProfile, Rubric, SessionPlan, SessionReport


class PackageRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    access_token: str
    status: str                       # "compiling" -> "ready" | "failed"
    jd_text: str
    candidate_profile: CandidateProfile | None
    rubric: Rubric | None


class SessionRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    package_id: str
    index: int
    status: str                       # "planned" -> "scoring" -> "scored" | "failed"
    session_plan: SessionPlan | None
    audio_path: str | None
    report: SessionReport | None


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

    def set_package_profile(self, package_id: str, profile: CandidateProfile) -> None:
        ...

    def set_package_rubric(self, package_id: str, rubric: Rubric | None,
                           status: str) -> None:
        """rubric=None marks a failed compile: status update only, no rubric write."""
        ...

    def create_session(self, package_id: str, index: int,
                       plan: SessionPlan) -> SessionRow:
        ...

    def get_session(self, session_id: str) -> SessionRow:
        ...

    def set_session_status(self, session_id: str, status: str,
                           audio_path: str | None = None) -> None:
        ...

    def save_report(self, session_id: str, report: SessionReport) -> None:
        ...
