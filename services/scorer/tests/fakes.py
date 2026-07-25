"""Shared fake clients for tests (house pattern: canned responses + a calls list).

Mirrors scorer/realtime_probe/fake.py: constructors take scripted responses,
every interaction is recorded for assertions, nothing touches the network.
Defined once here and reused by every task's tests (imported as
`from fakes import FakeGenAI` -- pytest puts tests/ on sys.path).
"""
from __future__ import annotations

from typing import Any

from google.genai import types

from scorer.api.db import PackageRow, SessionRow
from scorer.schemas import CandidateProfile, Rubric, SessionPlan, SessionReport


class _FakeCandidate:
    def __init__(self, grounding_metadata: Any = None):
        self.grounding_metadata = grounding_metadata


class _FakeResponse:
    """Response stand-in: .text plus .candidates[0].grounding_metadata."""

    def __init__(self, text: str, grounding_metadata: Any = None):
        self.text = text
        self.candidates = [_FakeCandidate(grounding_metadata)]


class _FakeFileHandle:
    """Non-str stand-in for the types.File handle files.upload returns."""

    def __init__(self, index: int):
        self.name = f"files/fake-{index}"
        self.uri = f"https://fake.local/files/fake-{index}"


def _metadata_from(entries: list[dict[str, str]]) -> types.GroundingMetadata:
    """{url,title,snippet} dicts -> real google-genai grounding metadata shapes."""
    chunks = [
        types.GroundingChunk(
            web=types.GroundingChunkWeb(uri=entry["url"], title=entry["title"]))
        for entry in entries
    ]
    supports = [
        types.GroundingSupport(segment=types.Segment(text=entry["snippet"]),
                               grounding_chunk_indices=[i])
        for i, entry in enumerate(entries)
    ]
    return types.GroundingMetadata(grounding_chunks=chunks,
                                   grounding_supports=supports)


class _FakeModels:
    def __init__(self, owner: FakeGenAI):
        self._owner = owner

    def generate_content(self, *, model: str, contents: Any,
                         config: Any = None) -> _FakeResponse:
        owner = self._owner
        # config is recorded exactly as passed -- never normalized (pinned).
        owner.calls.append({"model": model, "contents": contents, "config": config})
        # IndexError when the canned script is exhausted -- pinned behavior
        # that downstream failure-path tests (Task 12) rely on.
        text = owner.canned_texts.pop(0)
        raw = owner.canned_grounding.pop(0) if owner.canned_grounding else None
        metadata = _metadata_from(raw) if isinstance(raw, list) else raw
        return _FakeResponse(text, metadata)


class _FakeFiles:
    def __init__(self):
        self.uploads: list[Any] = []

    def upload(self, *, file: Any) -> _FakeFileHandle:
        self.uploads.append(file)
        return _FakeFileHandle(len(self.uploads) - 1)


class FakeGenAI:
    """Canned google-genai client satisfying scorer.schemas.GenAIClientLike.

    canned_texts pop in order, one per models.generate_content call;
    IndexError once they are exhausted (failure-path tests rely on this).
    canned_grounding is optional and parallel to canned_texts; each entry is
    None, a list of {url,title,snippet} dicts (converted to real
    types.GroundingMetadata), or a prebuilt metadata object passed through
    as-is. Every generate_content call appends {"model", "contents",
    "config"} to .calls with config stored exactly as passed (never
    normalized); every files.upload appends its file argument to
    .files.uploads and returns a non-str handle.
    """

    def __init__(self, canned_texts: list[str],
                 canned_grounding: list[Any] | None = None):
        self.canned_texts = list(canned_texts)
        self.canned_grounding = list(canned_grounding) if canned_grounding else []
        self.calls: list[dict[str, Any]] = []
        self.models = _FakeModels(self)
        self.files = _FakeFiles()


class FakeDatabase:
    """In-memory Database implementation mirroring SupabaseDatabase semantics.

    Ids are deterministic -- pkg-N with matching tok-N, and sess-N -- so
    downstream tests (Task 12) can predict them (pinned surface). Rows are
    stored as the pydantic row models themselves; missing ids raise KeyError
    exactly like the Supabase adapter. PackageRow drops jd_url (per the
    interface registry), so it is kept in .jd_urls for assertions.
    """

    def __init__(self):
        self.packages: dict[str, PackageRow] = {}
        self.sessions: dict[str, SessionRow] = {}
        self.jd_urls: dict[str, str | None] = {}
        self._package_seq = 0
        self._session_seq = 0

    def create_package(self, jd_text: str, jd_url: str | None) -> PackageRow:
        self._package_seq += 1
        row = PackageRow(
            id=f"pkg-{self._package_seq}",
            access_token=f"tok-{self._package_seq}",
            status="compiling",
            jd_text=jd_text,
            candidate_profile=None,
            rubric=None,
        )
        self.packages[row.id] = row
        self.jd_urls[row.id] = jd_url
        return row

    def get_package(self, package_id: str) -> PackageRow:
        return self.packages[package_id]

    def get_package_by_token(self, access_token: str) -> PackageRow:
        for row in self.packages.values():
            if row.access_token == access_token:
                return row
        raise KeyError(access_token)

    def set_package_profile(self, package_id: str, profile: CandidateProfile) -> None:
        row = self.packages[package_id]
        self.packages[package_id] = row.model_copy(
            update={"candidate_profile": profile})

    def set_package_rubric(self, package_id: str, rubric: Rubric | None,
                           status: str) -> None:
        # rubric=None = failed compile: status update only, no rubric write.
        row = self.packages[package_id]
        update: dict[str, object] = {"status": status}
        if rubric is not None:
            update["rubric"] = rubric
        self.packages[package_id] = row.model_copy(update=update)

    def create_session(self, package_id: str, index: int,
                       plan: SessionPlan) -> SessionRow:
        if package_id not in self.packages:
            raise KeyError(package_id)  # mirrors the FK constraint
        self._session_seq += 1
        row = SessionRow(
            id=f"sess-{self._session_seq}",
            package_id=package_id,
            index=index,
            status="planned",
            session_plan=plan,
            audio_path=None,
            report=None,
        )
        self.sessions[row.id] = row
        return row

    def get_session(self, session_id: str) -> SessionRow:
        return self.sessions[session_id]

    def set_session_status(self, session_id: str, status: str,
                           audio_path: str | None = None) -> None:
        row = self.sessions[session_id]
        update: dict[str, object] = {"status": status}
        if audio_path is not None:
            update["audio_path"] = audio_path
        self.sessions[session_id] = row.model_copy(update=update)

    def save_report(self, session_id: str, report: SessionReport) -> None:
        row = self.sessions[session_id]
        self.sessions[session_id] = row.model_copy(
            update={"report": report, "status": "scored"})
