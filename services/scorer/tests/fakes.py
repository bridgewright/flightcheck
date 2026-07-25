"""Shared fake clients for tests (house pattern: canned responses + a calls list).

Mirrors scorer/realtime_probe/fake.py: constructors take scripted responses,
every interaction is recorded for assertions, nothing touches the network.
Defined once here and reused by every task's tests (imported as
`from fakes import FakeGenAI` -- pytest puts tests/ on sys.path).
"""
from __future__ import annotations

from typing import Any

from google.genai import types


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
