"""Shared fake clients for tests (house pattern: canned responses + a calls list).

Mirrors scorer/realtime_probe/fake.py: constructors take scripted responses,
every interaction is recorded for assertions, nothing touches the network.
Defined once here and reused by every task's tests (imported as
`from fakes import FakeGenAI` -- pytest puts tests/ on sys.path).
"""
from __future__ import annotations

import threading
from pathlib import Path
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
        # One lock covers recording and dispatch: the content judge calls this
        # from a thread pool, and popping a script concurrently must never
        # lose, duplicate, or misrecord a reply.
        with owner.lock:
            # config is recorded exactly as passed -- never normalized (pinned).
            owner.calls.append({"model": model, "contents": contents, "config": config})
            keyed = owner.keyed_queue_for(contents)
            if keyed is not None:
                # Keyed replies never carry grounding metadata (no keyed
                # consumer reads it); IndexError when the key's script is
                # exhausted, mirroring the ordered queue's pinned behavior.
                reply = keyed.pop(0)
                if isinstance(reply, Exception):
                    raise reply
                return _FakeResponse(reply)
            # IndexError when the canned script is exhausted -- pinned behavior
            # that downstream failure-path tests (Task 12) rely on.
            item = owner.canned_texts.pop(0)
            if isinstance(item, Exception):
                raise item
            raw = owner.canned_grounding.pop(0) if owner.canned_grounding else None
            metadata = _metadata_from(raw) if isinstance(raw, list) else raw
            return _FakeResponse(item, metadata)


class _FakeFiles:
    def __init__(self):
        self.uploads: list[Any] = []

    def upload(self, *, file: Any) -> _FakeFileHandle:
        self.uploads.append(file)
        return _FakeFileHandle(len(self.uploads) - 1)


class FakeGenAI:
    """Canned google-genai client satisfying scorer.schemas.GenAIClientLike.

    Thread-safe: the content judge issues generate_content from a thread
    pool, so dispatch and call recording happen under one lock. Two dispatch
    modes, combinable:

    - canned_texts pop in order, one per models.generate_content call;
      IndexError once they are exhausted (failure-path tests rely on this).
    - keyed_texts maps a marker string (judge tests use the rubric dimension
      key) to that marker's own ordered reply script. A call whose prompt
      contains exactly one marker pops from that script (IndexError when it
      is exhausted, same pinned failure behavior); several markers in one
      prompt is ambiguous and raises ValueError; no marker falls back to
      canned_texts. Keying by what the prompt asks makes parallel judge
      tests order-independent: concurrent calls interleave freely without
      changing which reply each dimension receives. Keyed replies never
      carry grounding metadata.

    Scripted entries may be Exception instances, which are raised after the
    call is recorded instead of returned.

    canned_grounding is optional and parallel to canned_texts (keyed replies
    never consume it); each entry is None, a list of {url,title,snippet}
    dicts (converted to real types.GroundingMetadata), or a prebuilt
    metadata object passed through as-is. Every generate_content call
    appends {"model", "contents", "config"} to .calls with config stored
    exactly as passed (never normalized); every files.upload appends its
    file argument to .files.uploads and returns a non-str handle.
    """

    def __init__(self, canned_texts: list[str | Exception] | None = None,
                 canned_grounding: list[Any] | None = None,
                 keyed_texts: dict[str, list[str | Exception]] | None = None):
        self.canned_texts = list(canned_texts or [])
        self.canned_grounding = list(canned_grounding) if canned_grounding else []
        self.keyed_texts = {key: list(texts) for key, texts in (keyed_texts or {}).items()}
        self.calls: list[dict[str, Any]] = []
        self.lock = threading.Lock()
        self.models = _FakeModels(self)
        self.files = _FakeFiles()

    def keyed_queue_for(self, contents: Any) -> list[str | Exception] | None:
        """The keyed script matching the prompt's marker, or None for the ordered queue."""
        if not self.keyed_texts:
            return None
        parts = contents if isinstance(contents, list) else [contents]
        prompt = " ".join(part for part in parts if isinstance(part, str))
        matches = [key for key in self.keyed_texts if key in prompt]
        if len(matches) > 1:
            raise ValueError(
                f"prompt matches multiple keyed_texts markers: {sorted(matches)}"
            )
        return self.keyed_texts[matches[0]] if matches else None


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
        # Every successful set_scoring_stage call, in order, as
        # (session_id, stage) -- progression assertions read this.
        self.stage_writes: list[tuple[str, str]] = []
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
            user_id=None,
            total_sessions=6,
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

    def list_packages_by_user(self, user_id: str) -> list[PackageRow]:
        return [
            row for row in reversed(list(self.packages.values()))
            if row.user_id == user_id
        ]

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

    def find_ready_rubric_by_jd(self, jd_text):
        for row in reversed(list(self.packages.values())):
            if (row.jd_text == jd_text and row.status == "ready"
                    and row.rubric is not None):
                return (row.candidate_profile, row.rubric)
        return None

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
            created_at=f"2026-08-02T00:00:{self._session_seq:02d}+00:00",
        )
        self.sessions[row.id] = row
        return row

    def get_session(self, session_id: str) -> SessionRow:
        return self.sessions[session_id]

    def list_sessions(self, package_id: str) -> list[SessionRow]:
        # A filter, not a lookup: an unknown package_id yields [] (mirrors
        # PostgREST select-by-eq), never KeyError.
        return sorted(
            (row for row in self.sessions.values() if row.package_id == package_id),
            key=lambda row: row.index,
        )

    def set_session_status(self, session_id: str, status: str,
                           audio_path: str | None = None) -> None:
        row = self.sessions[session_id]
        update: dict[str, object] = {"status": status}
        if status in ("scored", "failed"):
            # Mirrors SupabaseDatabase: terminal status writes clear the
            # in-progress stage marker in the same write.
            update["scoring_stage"] = None
        if audio_path is not None:
            update["audio_path"] = audio_path
        self.sessions[session_id] = row.model_copy(update=update)

    def set_scoring_stage(self, session_id: str, stage: str) -> None:
        row = self.sessions[session_id]  # KeyError when absent (pinned)
        self.stage_writes.append((session_id, stage))
        self.sessions[session_id] = row.model_copy(update={"scoring_stage": stage})

    def save_report(self, session_id: str, report: SessionReport) -> None:
        row = self.sessions[session_id]
        self.sessions[session_id] = row.model_copy(
            update={"report": report, "status": "scored", "scoring_stage": None})


class FakeStorage:
    """In-memory Storage: canned recording bytes and corpus texts (pinned).

    recordings maps storage_path -> raw audio bytes written out on download;
    corpus maps a bucket-relative path -> file text written out on
    sync_corpus (nested paths like "fewshot/example.json" land in
    subdirectories, mirroring SupabaseStorage's fewshot/ pass).
    """

    def __init__(self, recordings: dict[str, bytes] | None = None,
                 corpus: dict[str, str] | None = None):
        self.recordings: dict[str, bytes] = dict(recordings or {})
        self.corpus: dict[str, str] = dict(corpus or {})

    def download_recording(self, storage_path: str, dest_dir: Path) -> Path:
        data = self.recordings[storage_path]  # KeyError when absent (pinned)
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / Path(storage_path).name
        dest.write_bytes(data)
        return dest

    def sync_corpus(self, dest_dir: Path) -> Path:
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        for name, text in self.corpus.items():
            target = dest_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        return dest_dir
