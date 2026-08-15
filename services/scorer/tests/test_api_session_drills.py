"""F-09 remainder (DECISIONS 079): the advised drills reach the next interviewer.

The report tells the customer what to drill; before this, the next
session's interviewer had no memory of it -- a coach that forgets its own
advice is six strangers, not a program. Both instruction-building routes
(the session mint and the session read) pass the MOST RECENT scored
session's report.next_drills; the standard render carries them as one calm
carry-over block, and a session with no scored predecessor renders exactly
as before.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from factories import make_rubric, ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import (
    DeliveryMetrics,
    DimensionScore,
    SessionReport,
)
from scorer.sessionplan.planner import plan_baseline_session

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _report(session_id: str, drills: list[str]) -> SessionReport:
    return SessionReport(
        session_id=session_id,
        verdict="approaching",
        overall_score=3.4,
        dimension_scores=[
            DimensionScore(
                dimension_key="structured-answers", score=3.1,
                evidence_quotes=["we cut churn by 12 percent"],
                rationale="One concrete example with thin detail."),
            DimensionScore(
                dimension_key="pacing-control", score=3.7,
                evidence_quotes=["04:12"],
                rationale="Steady pace; one long silence observed at 04:12."),
        ],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=148.0, wpm_timeline=[150.0, 146.0], silence_events=[],
            filler_count=6, filler_rate_per_min=1.4, f0_variance=812.5,
            avg_response_latency_s=1.1),
        delivery_observations=[],
        strengths=["Quantifies outcomes without prompting."],
        gaps=["Long pauses before pressure answers."],
        next_drills=drills,
        limits_note=("Scores reflect agreement with the rubric, "
                     "not an admission prediction."),
    )


def _seed():
    db = FakeDatabase()
    package = ready_package(db, paid_at="2026-08-10T00:00:00+00:00")
    client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))
    return client, db, package


def _scored_session(db: FakeDatabase, package_id: str, index: int,
                    drills: list[str]) -> str:
    plan = plan_baseline_session(make_rubric(), session_index=index)
    row = db.create_session(package_id, index, plan)
    db.save_report(row.id, _report(row.id, drills))
    return row.id


DRILL = "Drill for Structured answers: open with the outcome, then the method."


def test_create_session_carries_the_previous_reports_drills():
    client, db, package = _seed()
    _scored_session(db, package.id, 1, [DRILL])

    body = client.post("/api/sessions", json={"package_id": package.id},
                       headers=AUTH).json()

    assert body["index"] == 2
    instructions = body["interviewer_instructions"]
    assert "# CARRY-OVER" in instructions
    assert f"- {DRILL}" in instructions


def test_get_session_read_rebuilds_the_same_carry_over():
    client, db, package = _seed()
    _scored_session(db, package.id, 1, [DRILL])
    session_id = client.post("/api/sessions", json={"package_id": package.id},
                             headers=AUTH).json()["session_id"]

    body = client.get(f"/api/sessions/{session_id}", headers=AUTH).json()

    assert "# CARRY-OVER" in body["interviewer_instructions"]
    assert f"- {DRILL}" in body["interviewer_instructions"]


def test_the_most_recent_scored_report_wins():
    # DECISIONS 079: stale advice compounds; the most recent scored session
    # is the live coaching state -- earlier drills never ride along.
    client, db, package = _seed()
    _scored_session(db, package.id, 1, ["Stale drill from session one."])
    _scored_session(db, package.id, 2, [DRILL])

    instructions = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH,
    ).json()["interviewer_instructions"]

    assert f"- {DRILL}" in instructions
    assert "Stale drill from session one." not in instructions


def test_a_first_session_renders_without_a_carry_over_block():
    client, _, package = _seed()

    instructions = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH,
    ).json()["interviewer_instructions"]

    assert "# CARRY-OVER" not in instructions


def test_a_scored_sessions_own_drills_never_leak_into_its_read():
    # The report is written AFTER the interview it scores: rebuilding that
    # session's instructions must only ever see reports from EARLIER
    # sessions, or the trail would claim advice the interviewer never had.
    client, db, package = _seed()
    session_id = _scored_session(db, package.id, 1, [DRILL])

    body = client.get(f"/api/sessions/{session_id}", headers=AUTH).json()

    assert "# CARRY-OVER" not in body["interviewer_instructions"]
