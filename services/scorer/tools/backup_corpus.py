"""Back up and restore the rubric corpus bucket -- the one unbacked-up asset.

Everything else in this system has a second copy. Postgres has Supabase's
managed backups. Recordings are reproducible: a customer can run the session
again. Code is in git. The corpus is none of those -- it is confidential, so
it is deliberately NOT in this public repo (workspace rule R3), it was
assembled by hand over weeks, and it exists in exactly one place: the
`corpus` bucket.

Losing it does not raise anything. SupabaseStorage.sync_corpus over an empty
bucket returns an empty directory, the compiler writes "(no corpus documents
provided)" into the prompt, and every rubric compiled from that moment on is
quietly worse than the ones before it. No error, no log line, no alert --
just a product that has stopped being as good as it was. That silence is why
this tool exists.

Usage (from services/scorer, env from .env):

    # take a backup into a dated directory
    uv run python tools/backup_corpus.py backup --dest ~/flightcheck-backups

    # verify one, any time, with a tool that is not this repo
    cd ~/flightcheck-backups/corpus-2026-08-03 && shasum -a 256 -c MANIFEST.sha256

    # put one back (dry run first -- that is the default)
    uv run python tools/backup_corpus.py restore --from ~/flightcheck-backups/corpus-2026-08-03
    uv run python tools/backup_corpus.py restore --from ... --execute

See docs/ops/backup-restore.md for where backups live and how often to take
one.
"""
from __future__ import annotations

import argparse
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from scorer.api.storage import CORPUS_BUCKET, FEWSHOT_SUBDIR

MANIFEST_NAME = "MANIFEST.sha256"


class CorpusBucket(Protocol):
    """The three storage-bucket calls this tool makes (supabase-py shaped)."""

    def list(self, path: str = "") -> list[dict]:
        ...

    def download(self, name: str) -> bytes:
        ...

    def upload(self, path: str, file: bytes,
               file_options: dict | None = None) -> Any:
        ...


class EmptyCorpusError(Exception):
    """The corpus bucket held no documents, so no backup was written.

    Raised instead of writing an empty directory with an empty manifest.
    That artifact would sit in the backup folder looking exactly like a
    real backup, and would restore nothing -- the worst possible outcome
    for the one asset with no other copy. An empty bucket is either a
    brand-new project or the disaster this tool exists for; both deserve to
    stop the operator rather than print a reassuring line.
    """


@dataclass(frozen=True)
class CorpusTransfer:
    """What a backup or a restore accounted for."""

    document_count: int
    byte_count: int

    @property
    def is_empty(self) -> bool:
        return self.document_count == 0


def corpus_entries(bucket: CorpusBucket) -> list[str]:
    """Bucket-relative paths of every corpus document, sorted.

    Deliberately the SAME selection SupabaseStorage.sync_corpus reads:
    `*.md` at the root and `fewshot/*.json`. Backing up more than the reader
    consumes wastes space; backing up less produces a backup that restores
    to a subtly different corpus, which is worse than no backup because it
    looks like one. The root listing also returns a bare "fewshot" folder
    entry, which is not a document and is filtered by the extension rule.
    """
    names = [entry["name"] for entry in bucket.list()
             if entry["name"].endswith(".md")]
    names += [f"{FEWSHOT_SUBDIR}/{entry['name']}"
              for entry in bucket.list(FEWSHOT_SUBDIR)
              if entry["name"].endswith(".json")]
    return sorted(names)


def manifest_lines(documents: dict[str, bytes]) -> list[str]:
    """`<sha256>  <path>` per document, sorted by path.

    Exactly the `shasum -a 256 -c` input format, on purpose: verifying a
    backup years from now must not require this repo, this tool, or Python.
    """
    return [f"{hashlib.sha256(body).hexdigest()}  {name}"
            for name, body in sorted(documents.items())]


def backup_corpus(bucket: CorpusBucket, dest: Path) -> CorpusTransfer:
    """Download the whole corpus into `dest` and write its manifest.

    Downloads EVERYTHING before writing anything: a directory holding half
    the corpus under a manifest that vouches for it is the failure this
    ordering exists to prevent. A failed download raises with nothing on
    disk to mistake for a backup.

    `dest` must not exist. Reusing a directory would silently mix two
    backups, and the manifest would describe neither. An empty bucket
    raises EmptyCorpusError rather than writing a decoy.
    """
    dest = Path(dest)
    if dest.exists():
        raise FileExistsError(
            f"{dest} already exists; back up into a new directory so a "
            "partial overwrite cannot masquerade as a complete backup")

    entries = corpus_entries(bucket)
    if not entries:
        raise EmptyCorpusError(
            "the corpus bucket holds no documents; refusing to write an "
            "empty directory that would look like a backup and restore "
            "nothing")
    documents = {name: bucket.download(name) for name in entries}

    dest.mkdir(parents=True)
    for name, body in documents.items():
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    lines = manifest_lines(documents)
    (dest / MANIFEST_NAME).write_text(
        "".join(f"{line}\n" for line in lines))
    return CorpusTransfer(
        document_count=len(documents),
        byte_count=sum(len(body) for body in documents.values()),
    )


def read_verified_backup(source: Path) -> dict[str, bytes]:
    """Every document in a backup directory, checked against its manifest.

    The bucket IS the other copy, so restoring a corrupted backup over it is
    unrecoverable. Verification happens before a dry run too -- discovering
    the corruption at --execute time is discovering it too late.
    """
    source = Path(source)
    manifest = source / MANIFEST_NAME
    if not manifest.exists():
        raise FileNotFoundError(
            f"{manifest} not found; a directory without a manifest cannot be "
            "verified, and an unverified restore can destroy the only copy")
    documents: dict[str, bytes] = {}
    for line in manifest.read_text().splitlines():
        if not line.strip():
            continue
        digest, name = line.split("  ", 1)
        path = source / name
        if not path.exists():
            raise ValueError(f"{name} is in the manifest but missing from {source}")
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError(
                f"{name} does not match its manifest checksum; this backup is "
                "corrupted and must not be restored")
        documents[name] = body
    return documents


def restore_corpus(bucket: CorpusBucket, source: Path,
                   *, execute: bool) -> CorpusTransfer:
    """Upload a verified backup directory back into the corpus bucket.

    Dry run unless `execute` -- the same discipline tools/purge_user.py
    uses, for the same reason: the destructive step should never be the one
    that happens by default.
    """
    documents = read_verified_backup(source)
    if execute:
        for name, body in documents.items():
            # upsert: a restore overwrites whatever survived, which is the
            # point. Content type matters to nothing that reads this bucket.
            bucket.upload(name, body, {"upsert": "true"})
    return CorpusTransfer(
        document_count=len(documents),
        byte_count=sum(len(body) for body in documents.values()),
    )


def dated_backup_dir(parent: Path, now: datetime | None = None) -> Path:
    """`<parent>/corpus-YYYY-MM-DD`, so backups sort and never collide."""
    stamp = (now or datetime.now(UTC)).strftime("%Y-%m-%d")
    return Path(parent) / f"corpus-{stamp}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Back up or restore the confidential rubric corpus "
                    "bucket -- the only asset in this system with no other "
                    "copy.")
    commands = parser.add_subparsers(dest="command", required=True)

    backup = commands.add_parser(
        "backup", help="download the corpus into <dest>/corpus-YYYY-MM-DD")
    backup.add_argument(
        "--dest", required=True,
        help="parent directory for the dated backup directory")

    restore = commands.add_parser(
        "restore", help="upload a verified backup directory into the bucket")
    restore.add_argument(
        "--from", dest="source", required=True,
        help="a backup directory containing MANIFEST.sha256")
    restore.add_argument(
        "--execute", action="store_true",
        help="actually upload; without this flag the manifest is verified "
             "and the plan printed, but nothing is written")
    return parser


def main() -> None:
    args = build_parser().parse_args()

    from scorer.api.db import create_supabase_client
    from scorer.env import load_env

    load_env()
    bucket = create_supabase_client().storage.from_(CORPUS_BUCKET)

    if args.command == "backup":
        dest = dated_backup_dir(Path(args.dest))
        try:
            result = backup_corpus(bucket, dest)
        except EmptyCorpusError as err:
            # Never let this read as success: if the project is not brand
            # new, this IS the incident.
            print(f"ABORTED: the {CORPUS_BUCKET} bucket is EMPTY -- {err}")
            raise SystemExit(1) from err
        print(f"Backed up {result.document_count} document(s), "
              f"{result.byte_count} bytes, to {dest}")
        print(f"Verify any time: cd {dest} && shasum -a 256 -c {MANIFEST_NAME}")
        return

    source = Path(args.source)
    result = restore_corpus(bucket, source, execute=args.execute)
    if not args.execute:
        print(f"Dry run: {source} verifies against its manifest and holds "
              f"{result.document_count} document(s), {result.byte_count} bytes.")
        print("Nothing uploaded. Pass --execute to restore.")
        return
    print(f"Restored {result.document_count} document(s) into the "
          f"{CORPUS_BUCKET} bucket from {source}")


if __name__ == "__main__":
    main()
