"""Backfill transcripts for sessions scored before transcript persistence (WP-A).

Manual, cost-gated operator tool -- never part of the app or the gates.
Sessions scored before migration 004 added the transcript column have
transcript = null while their recording still sits in the private bucket.
Each executed backfill costs one Gemini transcription call, so the default
is a dry run that only lists candidates; --execute is the explicit spend
switch and running it at all is a separate user decision.

Usage (from services/scorer, env from .env):
    uv run python tools/backfill_transcripts.py               # dry run
    uv run python tools/backfill_transcripts.py --limit 3     # dry run, capped
    uv run python tools/backfill_transcripts.py --execute --limit 3
"""
from __future__ import annotations

import argparse
import tempfile
import traceback
from pathlib import Path

from scorer.api.db import Database
from scorer.api.storage import Storage
from scorer.audio_utils import ensure_wav
from scorer.content.transcribe import transcribe_verbatim
from scorer.schemas import GenAIClientLike

# Only rows whose run already ended are candidates: a "scoring" row's
# pipeline owns its own transcript write, and rows that never reached a
# terminal state have no complete recording story to transcribe.
TERMINAL_STATUSES = ("scored", "failed", "insufficient")


def select_candidates(rows: list[dict], limit: int | None = None) -> list[dict]:
    """Filter enumeration rows (already transcript-null) to backfillable ones.

    rows carry at least {"id", "status", "audio_path"}; input order is
    preserved (the enumeration query orders oldest first).
    """
    picked = [
        row for row in rows
        if row["status"] in TERMINAL_STATUSES and row["audio_path"]
    ]
    return picked[:limit] if limit is not None else picked


def backfill_transcript(
    session_id: str,
    db: Database,
    storage: Storage,
    client: GenAIClientLike,
) -> int:
    """Download -> wav -> transcribe -> save; returns the segment count.

    Touches ONLY the transcript. The row's terminal status and report are
    history: backfill never re-scores, never re-judges, never rewrites what
    the original run concluded.
    """
    row = db.get_session(session_id)
    if row.audio_path is None:
        raise ValueError(f"session {session_id} has no recording to transcribe")
    with tempfile.TemporaryDirectory(prefix="flightcheck-backfill-") as tmp:
        local = storage.download_recording(row.audio_path, Path(tmp))
        wav = ensure_wav(local)
        segments = transcribe_verbatim(wav, client)
    db.save_transcript(session_id, segments)
    return len(segments)


def _enumerate_missing(supabase) -> list[dict]:
    """Sessions with no stored transcript, oldest first.

    A direct PostgREST query on purpose: the Database protocol deliberately
    has no cross-package enumeration (the app never needs one), and a
    manual ops tool does not justify widening that interface. The transcript
    column itself is never selected -- the null filter runs server-side.
    """
    return (
        supabase.table("sessions")
        .select("id, status, audio_path, created_at")
        .is_("transcript", "null")
        .order("created_at")
        .execute()
        .data
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill transcripts for sessions scored before "
                    "transcript persistence. Dry run by default.")
    parser.add_argument(
        "--execute", action="store_true",
        help="actually transcribe and save (one Gemini call per session); "
             "without this flag the tool only lists candidates")
    parser.add_argument(
        "--limit", type=int, default=None,
        help="cap the number of sessions considered (oldest first)")
    args = parser.parse_args()

    from scorer.api.db import SupabaseDatabase, create_supabase_client
    from scorer.api.storage import SupabaseStorage
    from scorer.env import load_env, require_key
    from scorer.genai_compat import make_client

    load_env()
    supabase = create_supabase_client()
    candidates = select_candidates(_enumerate_missing(supabase), args.limit)
    if not candidates:
        print("No sessions need a transcript backfill.")
        return
    if not args.execute:
        print(f"Dry run: {len(candidates)} session(s) would be backfilled "
              "(one Gemini transcription call each). Pass --execute to spend.")
        for row in candidates:
            print(f"  {row['id']}  status={row['status']}  "
                  f"created_at={row['created_at']}")
        return
    db = SupabaseDatabase(supabase)
    storage = SupabaseStorage(supabase)
    client = make_client(require_key("GEMINI_API_KEY"))
    done = failed = 0
    for row in candidates:
        try:
            count = backfill_transcript(row["id"], db, storage, client)
        except Exception:  # noqa: BLE001 -- one bad row must not abort the batch
            traceback.print_exc()
            print(f"  {row['id']}  FAILED (see traceback above)")
            failed += 1
        else:
            print(f"  {row['id']}  backfilled ({count} segments)")
            done += 1
    print(f"Backfilled {done} session(s); {failed} failed.")


if __name__ == "__main__":
    main()
