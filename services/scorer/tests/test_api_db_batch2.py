import pytest

from fakes import FakeDatabase
from scorer.api.db import FeedbackRow
from scorer.schemas import (
    ParaphraseMark,
    SessionInsights,
    SessionParaphrases,
    StudyMaterials,
    StudySummary,
)


def _session(db: FakeDatabase):
    package = db.create_package("JD", None)
    return db.create_session(package.id, 1, None)  # type: ignore[arg-type]


def test_feedback_contracts_and_unknown_status_target():
    db = FakeDatabase()
    first = db.insert_feedback(FeedbackRow(
        user_id="user-1", rating_half_stars=8, body="Useful"))
    second = db.insert_feedback(FeedbackRow(
        user_id="user-2", rating_half_stars=4, body="Needs work"))
    db.set_feedback_status(first.id or "", "seen")
    assert [row.id for row in db.list_feedback(None, 10)] == [second.id, first.id]
    assert db.list_feedback("seen", 10)[0].updated_at is not None
    assert db.list_feedback_for_user("user-1")[0].id == first.id
    with pytest.raises(KeyError):
        db.set_feedback_status("missing", "seen")


def test_coaching_documents_marks_and_session_deletion():
    db = FakeDatabase()
    session = _session(db)
    paraphrases = SessionParaphrases(
        generated_at="2026-08-08T00:00:00Z", turn_count=0, items=[])
    insights = SessionInsights(
        generated_at="2026-08-08T00:00:00Z", did_well=[], did_poorly=[],
        must_keep=[], must_answer=[])
    db.save_session_paraphrases(session.id, paraphrases)
    db.save_session_insights(session.id, insights)
    marks = db.set_paraphrase_mark(
        session.id, 3, ParaphraseMark(reaction="up", bookmarked=True))
    assert marks.marks["3"].bookmarked
    assert db.get_session_paraphrases(session.id) == paraphrases
    assert db.get_session_insights(session.id) == insights
    db.delete_rows("session", [session.id])
    assert session.id not in db.paraphrases | db.insights | db.marks


def test_study_regeneration_preserves_last_good_document():
    db = FakeDatabase()
    doc = StudyMaterials(
        source_session_ids=["session-1"],
        summary=StudySummary(core_problems=[], improvement_strategy=[],
                             priority_expressions=[]),
        jd_core_answers=[],
    )
    db.save_study_materials("package-1", doc, "2026-08-08T00:00:00Z")
    db.begin_study_generation("package-1")
    assert db.get_study("package-1").doc == doc  # type: ignore[union-attr]
    db.fail_study_generation("package-1")
    assert db.get_study("package-1").doc == doc  # type: ignore[union-attr]
