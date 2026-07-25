"""Tests for scorer.api.db -- row models, database protocol, and the fake."""
import pytest

from fakes import FakeDatabase
from scorer.api.db import Database, PackageRow, SessionRow
from scorer.schemas import (
    CandidateProfile,
    DeliveryMetrics,
    DimensionScore,
    Rubric,
    SessionPlan,
    SessionReport,
)

CITATION = {
    "url": "https://example.com/interview-guide",
    "title": "Example interview guide",
    "snippet": "Interviewers probe for specifics with follow-up questions.",
}


def _dim(key: str, channel: str, weight: float) -> dict:
    return {
        "key": key,
        "name": key.replace("-", " ").title(),
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": "Vague claims, no example."},
            {"score": 3, "behavior": "One example, thin detail."},
            {"score": 5, "behavior": "Specific and quantified."},
        ],
        "signals": ["named specifics"],
        "citations": [CITATION],
    }


def _rubric() -> Rubric:
    return Rubric.model_validate({
        "role_title": "Forward Deployed Product Manager",
        "company": "ExampleCo",
        "dimensions": [
            _dim("structured-answers", "content", 0.5),
            _dim("pacing-control", "delivery", 0.5),
        ],
        "question_bank": [{
            "dimension_key": "structured-answers",
            "question": "Walk me through a project you led end to end.",
            "probes": ["What was your specific role?"],
            "source": "generated",
        }],
        "research_summary": "Synthetic rubric for db tests.",
    })


def _question(key: str) -> dict:
    return {
        "dimension_key": key,
        "question": f"Tell me about {key.replace('-', ' ')}.",
        "probes": ["Give a concrete example."],
        "source": "generated",
    }


def _plan() -> SessionPlan:
    return SessionPlan.model_validate({
        "session_index": 1,
        "focus": "baseline",
        "question_sequence": [
            _question("structured-answers"),
            _question("pacing-control"),
        ],
        "pressure_probe": _question("structured-answers"),
        "time_budget_minutes": 20,
    })


def _profile() -> CandidateProfile:
    return CandidateProfile.model_validate({
        "name": "Alex Example",
        "headline": "Senior Product Analyst",
        "years_experience": "4+ years",
        "roles": ["Senior Product Analyst, ExampleCorp"],
        "skills": ["SQL", "Python"],
        "achievements": ["Cut dashboard load time 40%"],
    })


def _report(session_id: str) -> SessionReport:
    return SessionReport(
        session_id=session_id,
        verdict="ready",
        overall_score=4.2,
        dimension_scores=[
            DimensionScore(
                dimension_key="structured-answers", score=4.5,
                evidence_quotes=["we cut churn by 12 percent"],
                rationale="Quantified outcome, close to the score-5 anchor."),
            DimensionScore(
                dimension_key="pacing-control", score=3.9,
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
        next_drills=["Drill: 90-second answer with a stated structure up front."],
        limits_note=("Scores reflect agreement with the rubric, "
                     "not an admission prediction."),
    )


def test_fake_database_satisfies_protocol():
    assert isinstance(FakeDatabase(), Database)


def test_create_package_returns_compiling_row_with_deterministic_ids():
    db = FakeDatabase()
    row = db.create_package("We are hiring a Senior Product Analyst.", None)
    assert isinstance(row, PackageRow)
    assert row.status == "compiling"
    assert row.candidate_profile is None and row.rubric is None
    assert (row.id, row.access_token) == ("pkg-1", "tok-1")


def test_ids_and_tokens_increment_deterministically():
    db = FakeDatabase()
    a = db.create_package("jd a", None)
    b = db.create_package("jd b", "https://jobs.example.com/b")
    assert (a.id, a.access_token) == ("pkg-1", "tok-1")
    assert (b.id, b.access_token) == ("pkg-2", "tok-2")
    assert db.jd_urls[b.id] == "https://jobs.example.com/b"


def test_get_package_by_token_and_missing_lookups_raise_keyerror():
    db = FakeDatabase()
    row = db.create_package("jd text", None)
    assert db.get_package(row.id) == row
    assert db.get_package_by_token(row.access_token) == row
    with pytest.raises(KeyError):
        db.get_package("missing-id")
    with pytest.raises(KeyError):
        db.get_package_by_token("missing-token")


def test_set_profile_then_rubric_updates_row():
    db = FakeDatabase()
    row = db.create_package("jd text", None)
    db.set_package_profile(row.id, _profile())
    db.set_package_rubric(row.id, _rubric(), "ready")
    updated = db.get_package(row.id)
    assert updated.candidate_profile.name == "Alex Example"
    assert updated.rubric.role_title == "Forward Deployed Product Manager"
    assert updated.status == "ready"


def test_set_package_rubric_none_marks_failed_without_rubric_write():
    # rubric=None is the failed-compile path: status update only, no rubric
    # write (pinned in the interface registry; Task 12's except-handler
    # calls exactly this).
    db = FakeDatabase()
    row = db.create_package("jd text", None)
    db.set_package_rubric(row.id, None, "failed")
    updated = db.get_package(row.id)
    assert updated.status == "failed"
    assert updated.rubric is None


def test_create_session_starts_planned():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    assert isinstance(session, SessionRow)
    assert session.id == "sess-1"
    assert session.status == "planned"
    assert session.index == 1
    assert session.session_plan.focus == "baseline"
    assert db.get_session(session.id) == session


def test_create_session_unknown_package_raises_keyerror():
    with pytest.raises(KeyError):
        FakeDatabase().create_session("missing-package", 1, _plan())


def test_set_session_status_keeps_audio_path_unless_given():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    db.set_session_status(session.id, "scoring",
                          audio_path="packages/p1/session-1.webm")
    db.set_session_status(session.id, "failed")
    updated = db.get_session(session.id)
    assert updated.status == "failed"
    assert updated.audio_path == "packages/p1/session-1.webm"


def test_save_report_stores_report_and_marks_scored():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    report = _report(session.id)
    db.save_report(session.id, report)
    updated = db.get_session(session.id)
    assert updated.report == report
    assert updated.status == "scored"
