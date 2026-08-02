"""Tests for tools/backfill_transcripts.py -- the manual WP-A backfill tool.

Only the offline pieces are tested: candidate selection (pure) and the
per-session backfill against the fakes. Enumeration and main() are thin
Supabase/argparse wiring, exercised manually (the tool is operator-run and
cost-gated, never part of the app or the gates).
"""
import io
import json

import numpy as np
import soundfile as sf

from backfill_transcripts import backfill_transcript, select_candidates
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.schemas import QuestionSpec, SessionPlan

SEGMENTS_JSON = json.dumps({"segments": [
    {"start_s": 0.0, "end_s": 1.8, "speaker": "interviewer",
     "text": "Walk me through a project you led end to end."},
    {"start_s": 3.6, "end_s": 7.6, "speaker": "candidate",
     "text": "I led the churn dashboard rollout and we cut churn by 12 percent."},
]})


def _wav_bytes(duration_s: float = 2.0, sample_rate: int = 16000) -> bytes:
    """Synthesized recording (house rule: no committed audio binaries)."""
    t = np.linspace(0.0, duration_s, int(sample_rate * duration_s), endpoint=False)
    buf = io.BytesIO()
    sf.write(buf, 0.3 * np.sin(2 * np.pi * 220.0 * t), sample_rate,
             format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _plan() -> SessionPlan:
    question = QuestionSpec(
        dimension_key="structured-answers",
        question="Walk me through a project you led end to end.",
        probes=["What was your specific role?"],
        source="generated",
    )
    return SessionPlan(
        session_index=1,
        focus="baseline",
        question_sequence=[question],
        pressure_probe=question,
        time_budget_minutes=20,
    )


def _seed_terminal_session(db: FakeDatabase, status: str, audio_path: str | None):
    package = db.create_package("JD text", None)
    session = db.create_session(package.id, 1, _plan())
    if audio_path is not None:
        db.set_session_status(session.id, "planned", audio_path=audio_path)
    db.set_session_status(session.id, status)
    return db.get_session(session.id)


# --- select_candidates (pure) -------------------------------------------------


def test_select_candidates_keeps_terminal_rows_with_audio_in_order():
    rows = [
        {"id": "sess-1", "status": "scored", "audio_path": "p/1.webm"},
        {"id": "sess-2", "status": "scoring", "audio_path": "p/2.webm"},
        {"id": "sess-3", "status": "failed", "audio_path": "p/3.webm"},
        {"id": "sess-4", "status": "planned", "audio_path": None},
        {"id": "sess-5", "status": "insufficient", "audio_path": "p/5.webm"},
        {"id": "sess-6", "status": "failed", "audio_path": None},
    ]
    picked = select_candidates(rows)
    # "scoring" rows belong to their running pipeline; rows without a
    # recording have nothing to transcribe.
    assert [row["id"] for row in picked] == ["sess-1", "sess-3", "sess-5"]


def test_select_candidates_applies_the_limit_after_filtering():
    rows = [
        {"id": "sess-1", "status": "scoring", "audio_path": "p/1.webm"},
        {"id": "sess-2", "status": "scored", "audio_path": "p/2.webm"},
        {"id": "sess-3", "status": "scored", "audio_path": "p/3.webm"},
        {"id": "sess-4", "status": "scored", "audio_path": "p/4.webm"},
    ]
    picked = select_candidates(rows, limit=2)
    assert [row["id"] for row in picked] == ["sess-2", "sess-3"]


def test_select_candidates_without_limit_returns_everything():
    rows = [
        {"id": f"sess-{i}", "status": "scored", "audio_path": f"p/{i}.webm"}
        for i in range(1, 8)
    ]
    assert len(select_candidates(rows)) == 7


# --- backfill_transcript (against the fakes) ----------------------------------


def test_backfill_saves_the_transcript_and_touches_nothing_else():
    db = FakeDatabase()
    session = _seed_terminal_session(db, "scored", "packages/pkg-1/session-1.wav")
    storage = FakeStorage(
        recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    fake = FakeGenAI([SEGMENTS_JSON])

    count = backfill_transcript(session.id, db, storage, fake)

    assert count == 2
    transcript = db.get_transcript(session.id)
    assert transcript is not None
    assert [seg.speaker for seg in transcript] == ["interviewer", "candidate"]
    # One transcription call, zero judges: backfill never re-scores.
    assert len(fake.calls) == 1
    # The row's history is untouched -- status, report, stage all as left.
    stored = db.get_session(session.id)
    assert stored.status == "scored"
    assert stored.report is None
    assert stored.scoring_stage is None
    assert db.stage_writes == []


def test_backfill_leaves_a_failed_row_failed():
    db = FakeDatabase()
    session = _seed_terminal_session(db, "failed", "packages/pkg-1/session-1.wav")
    storage = FakeStorage(
        recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})

    backfill_transcript(session.id, db, storage, FakeGenAI([SEGMENTS_JSON]))

    assert db.get_transcript(session.id) is not None
    assert db.get_session(session.id).status == "failed"


def test_backfill_without_a_recording_raises_before_any_api_call():
    db = FakeDatabase()
    session = _seed_terminal_session(db, "failed", audio_path=None)
    fake = FakeGenAI([])

    try:
        backfill_transcript(session.id, db, FakeStorage(), fake)
    except ValueError as exc:
        assert session.id in str(exc)
    else:
        raise AssertionError("expected ValueError for a session with no recording")

    assert fake.calls == []
    assert db.get_transcript(session.id) is None
