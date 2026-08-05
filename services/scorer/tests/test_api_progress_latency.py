"""F-23: the progress feed carries avg response latency per session.

The reports have always measured it (DeliveryMetrics.avg_response_latency_s,
reduced by delivery.dsp), but the trend feed omitted it, so the progress
screen could not draw the one delivery number interviewers actually feel.
These tests pin the additive contract: the field rides every entry, it is
null whenever no report exists or the DSP could not measure it, and a null
never turns into a zero anywhere in the payload.
"""
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import DeliveryMetrics, DimensionScore, SessionReport
from scorer.sessionplan.planner import plan_baseline_session

AUTH = {"Authorization": "Bearer test-worker-token"}


def _client(monkeypatch, db: FakeDatabase) -> TestClient:
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([])))


def _report(session_id: str, *, latency: float | None) -> SessionReport:
    return SessionReport(
        session_id=session_id,
        verdict="approaching",
        overall_score=3.2,
        dimension_scores=[
            DimensionScore(
                dimension_key="structured-answers", score=3.2,
                evidence_quotes=["I led the churn dashboard rollout"],
                rationale="One clear example with thin surrounding detail."),
        ],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=138.0, wpm_timeline=[137.0, 139.0],
            silence_events=[], filler_count=3, filler_rate_per_min=1.1,
            f0_variance=650.0, avg_response_latency_s=latency),
        delivery_observations=[],
        strengths=["Names outcomes without prompting."],
        gaps=["Answers stay at the summary level."],
        next_drills=["Drill: add one quantified detail per answer."],
        limits_note="Scores reflect rubric agreement, not an admission "
                    "prediction.",
    )


def test_progress_carries_latency_for_scored_and_null_for_unscored(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    scored = db.create_session(package.id, 1,
                               plan_baseline_session(package.rubric))
    db.save_report(scored.id, _report(scored.id, latency=1.34))
    planned = db.create_session(package.id, 2,
                                plan_baseline_session(package.rubric))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/progress",
                      headers=AUTH).json()

    first, second = body["sessions"]
    assert first["session_id"] == scored.id
    assert first["avg_response_latency_s"] == 1.34
    assert second["session_id"] == planned.id
    assert second["avg_response_latency_s"] is None


def test_progress_latency_unmeasured_serializes_null_not_zero(monkeypatch):
    # A report whose DSP could not attribute any interviewer->candidate
    # handoff stores None -- the same shape every report has carried since
    # v0.1 when the measurement failed. The feed must pass the null through,
    # never coerce it to 0.0: a zero would read as an instant answer.
    db = FakeDatabase()
    package = ready_package(db)
    session = db.create_session(package.id, 1,
                                plan_baseline_session(package.rubric))
    db.save_report(session.id, _report(session.id, latency=None))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/progress",
                      headers=AUTH).json()

    (entry,) = body["sessions"]
    assert "avg_response_latency_s" in entry
    assert entry["avg_response_latency_s"] is None
