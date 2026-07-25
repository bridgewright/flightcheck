"""Recording and corpus blobs: the Storage protocol and the Supabase adapter.

Buckets (created in the Supabase dashboard, both private): "recordings"
holds session audio uploaded by the web app; "corpus" holds the confidential
rubric corpus (*.md at the root) plus few-shot rubrics under the fewshot/
prefix (*.json) -- never committed to this public repo (workspace rule R3).
Local dev bypass: SCORER_CORPUS_DIR points sync_corpus at a local directory
and skips the network entirely.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol, runtime_checkable

from supabase import Client

RECORDINGS_BUCKET = "recordings"
CORPUS_BUCKET = "corpus"
FEWSHOT_SUBDIR = "fewshot"    # bucket prefix "fewshot/"; Task 12 reads
                              # load_fewshots(corpus_dir / "fewshot")


@runtime_checkable
class Storage(Protocol):
    """Blob seam the pipeline consumes (Task 12); SupabaseStorage implements
    it, FakeStorage (tests/fakes.py) fakes it."""

    def download_recording(self, storage_path: str, dest_dir: Path) -> Path:
        ...

    def sync_corpus(self, dest_dir: Path) -> Path:
        ...


class SupabaseStorage:
    """Storage implementation over supabase-py Storage buckets.

    Construct with the shared client from scorer.api.db.create_supabase_client().
    """

    def __init__(self, client: Client):
        self._client = client

    def download_recording(self, storage_path: str, dest_dir: Path) -> Path:
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        data = self._client.storage.from_(RECORDINGS_BUCKET).download(storage_path)
        dest = dest_dir / Path(storage_path).name
        dest.write_bytes(data)
        return dest

    def sync_corpus(self, dest_dir: Path) -> Path:
        override = os.environ.get("SCORER_CORPUS_DIR")
        if override:
            return Path(override)
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        bucket = self._client.storage.from_(CORPUS_BUCKET)
        for entry in bucket.list():
            name = entry["name"]
            if not name.endswith(".md"):
                continue    # also skips the "fewshot" folder entry
            (dest_dir / name).write_bytes(bucket.download(name))
        # Supabase Storage listing is per-prefix (non-recursive), so the
        # fewshot/ subdirectory needs its own pass. Mirroring it here is what
        # makes load_fewshots(corpus_dir / "fewshot") work downstream (Task 12).
        for entry in bucket.list(FEWSHOT_SUBDIR):
            name = entry["name"]
            if not name.endswith(".json"):
                continue
            fewshot_dir = dest_dir / FEWSHOT_SUBDIR
            fewshot_dir.mkdir(parents=True, exist_ok=True)
            (fewshot_dir / name).write_bytes(
                bucket.download(f"{FEWSHOT_SUBDIR}/{name}"))
        return dest_dir
