"""Tests for scorer.api.storage -- storage protocol, supabase adapter, fake."""
from types import SimpleNamespace

import pytest

from fakes import FakeStorage
from scorer.api.storage import Storage, SupabaseStorage


class StubBucket:
    """Just enough of supabase-py's bucket API: prefix listing + downloads.

    Mirrors Supabase Storage's folder emulation: list(path) returns the
    immediate children of that prefix (files and "folder" entries), never
    recursing -- which is why sync_corpus must list the "fewshot" prefix
    explicitly.
    """

    def __init__(self, files: dict[str, bytes]):
        self.files = dict(files)
        self.downloads: list[str] = []

    def list(self, path: str = ""):
        prefix = f"{path}/" if path else ""
        children = {
            full[len(prefix):].split("/", 1)[0]
            for full in self.files
            if full.startswith(prefix)
        }
        return [{"name": name} for name in sorted(children)]

    def download(self, path: str) -> bytes:
        self.downloads.append(path)
        return self.files[path]


def _stub_client(buckets: dict[str, StubBucket]):
    return SimpleNamespace(
        storage=SimpleNamespace(from_=lambda name: buckets[name]))


def test_fake_storage_satisfies_protocol():
    assert isinstance(FakeStorage(), Storage)


def test_fake_download_recording_writes_canned_bytes(tmp_path):
    storage = FakeStorage(
        recordings={"packages/p1/session-1.webm": b"webm-bytes"})
    dest = storage.download_recording("packages/p1/session-1.webm",
                                      tmp_path / "downloads")
    assert dest == tmp_path / "downloads" / "session-1.webm"
    assert dest.read_bytes() == b"webm-bytes"


def test_fake_download_missing_recording_raises_keyerror(tmp_path):
    with pytest.raises(KeyError):
        FakeStorage().download_recording("missing.webm", tmp_path)


def test_fake_sync_corpus_writes_docs_and_returns_dir(tmp_path):
    storage = FakeStorage(
        corpus={"fdpm-guide.md": "# FDPM interview guide\nBe specific."})
    result = storage.sync_corpus(tmp_path / "corpus")
    assert result == tmp_path / "corpus"
    assert (result / "fdpm-guide.md").read_text() == (
        "# FDPM interview guide\nBe specific.")


def test_fake_sync_corpus_writes_nested_fewshot_paths(tmp_path):
    # Pinned surface: corpus keys are bucket-relative paths; nested keys
    # like "fewshot/x.json" land in subdirectories so Task 12's
    # load_fewshots(corpus_dir / "fewshot") finds them.
    storage = FakeStorage(corpus={
        "fdpm-guide.md": "# FDPM interview guide\nBe specific.",
        "fewshot/example-rubric.json": "{}",
    })
    result = storage.sync_corpus(tmp_path / "corpus")
    assert (result / "fdpm-guide.md").exists()
    assert (result / "fewshot" / "example-rubric.json").read_text() == "{}"


def test_supabase_download_recording_pulls_from_recordings_bucket(tmp_path):
    bucket = StubBucket({"packages/p1/session-1.webm": b"audio-bytes"})
    storage = SupabaseStorage(_stub_client({"recordings": bucket}))
    dest = storage.download_recording("packages/p1/session-1.webm",
                                      tmp_path / "work")
    assert dest == tmp_path / "work" / "session-1.webm"
    assert dest.read_bytes() == b"audio-bytes"
    assert bucket.downloads == ["packages/p1/session-1.webm"]


def test_supabase_sync_corpus_downloads_only_markdown(tmp_path, monkeypatch):
    monkeypatch.delenv("SCORER_CORPUS_DIR", raising=False)
    bucket = StubBucket({
        "fdpm-guide.md": b"# FDPM guide",
        "notes.txt": b"not markdown",
    })
    storage = SupabaseStorage(_stub_client({"corpus": bucket}))
    result = storage.sync_corpus(tmp_path / "corpus")
    assert result == tmp_path / "corpus"
    assert (result / "fdpm-guide.md").read_bytes() == b"# FDPM guide"
    assert not (result / "notes.txt").exists()
    assert bucket.downloads == ["fdpm-guide.md"]


def test_supabase_sync_corpus_mirrors_fewshot_subdirectory(tmp_path, monkeypatch):
    monkeypatch.delenv("SCORER_CORPUS_DIR", raising=False)
    bucket = StubBucket({
        "fdpm-guide.md": b"# FDPM guide",
        "fewshot/example-rubric.json": b"{}",
    })
    storage = SupabaseStorage(_stub_client({"corpus": bucket}))
    result = storage.sync_corpus(tmp_path / "corpus")
    assert (result / "fdpm-guide.md").read_bytes() == b"# FDPM guide"
    assert (result / "fewshot" / "example-rubric.json").read_bytes() == b"{}"
    assert "fewshot/example-rubric.json" in bucket.downloads


def test_supabase_sync_corpus_honors_env_override(tmp_path, monkeypatch):
    override = tmp_path / "local-corpus"
    override.mkdir()
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(override))
    storage = SupabaseStorage(client=None)  # any network use would crash on None
    assert storage.sync_corpus(tmp_path / "unused") == override
