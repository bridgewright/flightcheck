"""F-74 study job: the background task's crash-safety and its write contract.

Two contracts, and both are about what happens when something goes wrong.

**Nothing escapes.** A FastAPI BackgroundTask that raises takes the worker's
event loop down with it, and with it every session in flight -- not just this
build. So the job swallows everything, including a failure inside its own
failure handler. `score_session_job` holds the same contract; this module
exists separately only because api/jobs.py was frozen while five tracks ran
in parallel (see the module docstring).

**A failed rebuild never destroys the guide the customer already had.** The
status row and the document are one row, so "generating" is written over a
row that still holds the previous doc, and a failure leaves that doc exactly
where it was. A customer who presses Rebuild and hits a model outage loses
nothing.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

import pytest

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI
from scorer.schemas import (
    DeliveryMetrics,
    DimensionScore,
    InsightExpression,
    SessionInsights,
    SessionReport,
    StudyMaterials,
)
from scorer.sessionplan.planner import plan_baseline_session
from scorer.study.job import generate_study_job

QUOTE = "I led the churn dashboard rollout"


def _report(session_id: str) -> SessionReport:
    return SessionReport(
        session_id=session_id, verdict="approaching", overall_score=3.2,
        dimension_scores=[DimensionScore(
            dimension_key="structured-answers", score=3.2,
            evidence_quotes=[QUOTE], rationale="One clear example.")],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=138.0, wpm_timeline=[137.0], silence_events=[],
            filler_count=3, filler_rate_per_min=1.1, f0_variance=650.0,
            avg_response_latency_s=1.2),
        delivery_observations=[], strengths=["Names outcomes."],
        gaps=["Stays at the summary level."], next_drills=["Add a number."],
        limits_note="Scores reflect rubric agreement.",
    )


def _seed(db: FakeDatabase, *, sessions: int = 1, insights: bool = True):
    package = ready_package(db)
    rows = []
    for index in range(1, sessions + 1):
        row = db.create_session(package.id, index,
                                plan_baseline_session(package.rubric))
        db.save_report(row.id, _report(row.id))
        if insights:
            db.save_session_insights(row.id, SessionInsights(
                generated_at="2026-08-08T00:00:00+00:00",
                did_well=["Opened with the outcome."], did_poorly=[],
                must_keep=[InsightExpression(
                    turn_index=2, said_verbatim=QUOTE,
                    better=f"{QUOTE}, cutting handle time 18%",
                    why="The number is what gets remembered.")],
                must_answer=[]))
        rows.append(row)
    return package, rows


def _reply(session_ids) -> str:
    return json.dumps({
        "schema_version": 1,
        "source_session_ids": list(session_ids),
        "summary": {
            "core_problems": [{"title": "Answers stay abstract",
                               "description": "No number behind the example.",
                               "dimension_keys": ["structured-answers"]}],
            "improvement_strategy": ["Name the metric.", "Slow the close.",
                                     "Cut to ninety seconds."],
            "priority_expressions": ["cutting handle time 18%"],
        },
        "jd_core_answers": [{
            "question": "Walk me through a project you led end to end.",
            "dimension_key": "structured-answers",
            "model_answer": "Outcome first, then mechanism.",
            "based_on_quotes": [QUOTE],
        }],
    })


def _previous_doc() -> StudyMaterials:
    return StudyMaterials(
        source_session_ids=["sess-old"],
        summary={"core_problems": [{"title": "The guide they already had",
                                    "description": "Built last week.",
                                    "dimension_keys": ["structured-answers"]}],
                 "improvement_strategy": ["Keep going."],
                 "priority_expressions": ["a phrase worth keeping"]},
        jd_core_answers=[],
    )


class _CountingDatabase:
    """FakeDatabase with the two study writes counted, and optionally broken."""

    def __init__(self, inner: FakeDatabase, *, break_save: bool = False,
                 break_fail: bool = False):
        self._inner = inner
        self.saves = 0
        self.fails = 0
        self._break_save = break_save
        self._break_fail = break_fail

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def save_study_materials(self, package_id, doc, generated_at):
        self.saves += 1
        if self._break_save:
            raise RuntimeError("database is down")
        self._inner.save_study_materials(package_id, doc, generated_at)

    def fail_study_generation(self, package_id):
        self.fails += 1
        if self._break_fail:
            raise RuntimeError("database is still down")
        self._inner.fail_study_generation(package_id)


# --- the success path -----------------------------------------------------


def test_success_writes_the_document_status_and_stamp_in_one_save():
    # One save, not three. The row carries the document AND the status, so a
    # sequence of partial writes would leave a window where the page reads
    # "ready" with nothing to show.
    inner = FakeDatabase()
    package, rows = _seed(inner)
    db = _CountingDatabase(inner)
    db.begin_study_generation(package.id)

    generate_study_job(package.id, db, FakeGenAI([_reply([rows[0].id])]))

    assert (db.saves, db.fails) == (1, 0)
    row = inner.get_study(package.id)
    assert row.status == "ready"
    assert row.doc.source_session_ids == [rows[0].id]
    assert row.generated_at is not None


def test_the_generated_stamp_is_an_aware_utc_instant():
    # Read back by the web as an ISO string and formatted for display; a naive
    # stamp would render an hour or nine off and compare wrong against the
    # staleness window.
    db = FakeDatabase()
    package, rows = _seed(db)

    generate_study_job(package.id, db, FakeGenAI([_reply([rows[0].id])]))

    stamp = datetime.fromisoformat(db.get_study(package.id).generated_at)
    assert stamp.tzinfo is not None
    assert stamp.utcoffset().total_seconds() == 0


def test_only_sessions_with_reports_are_consumed():
    db = FakeDatabase()
    package, rows = _seed(db, sessions=1)
    # A planned session: a slot the customer opened and never finished.
    db.create_session(package.id, 2, plan_baseline_session(package.rubric))

    generate_study_job(package.id, db, FakeGenAI([_reply([rows[0].id])]))

    assert db.get_study(package.id).doc.source_session_ids == [rows[0].id]


def test_the_candidates_own_words_reach_the_model():
    db = FakeDatabase()
    package, rows = _seed(db)
    client = FakeGenAI([_reply([rows[0].id])])

    generate_study_job(package.id, db, client)

    assert QUOTE in client.calls[0]["contents"]


def test_a_package_whose_sessions_have_no_insights_still_builds():
    # T4 writes insights. A package scored before it ran has none, and the
    # guide must degrade to a thinner document rather than fail.
    db = FakeDatabase()
    package, rows = _seed(db, insights=False)

    generate_study_job(package.id, db, FakeGenAI([_reply([rows[0].id])]))

    assert db.get_study(package.id).status == "ready"


# --- the failure paths ----------------------------------------------------


def test_a_generator_failure_leaves_the_previous_guide_in_place():
    # The contract that makes Rebuild safe to press.
    db = FakeDatabase()
    package, _ = _seed(db)
    db.save_study_materials(package.id, _previous_doc(),
                            "2026-08-01T00:00:00+00:00")
    db.begin_study_generation(package.id)

    generate_study_job(package.id, db, FakeGenAI([]))   # empty script -> raises

    row = db.get_study(package.id)
    assert row.status == "failed"
    assert row.doc.source_session_ids == ["sess-old"]
    assert row.generated_at == "2026-08-01T00:00:00+00:00"


def test_beginning_a_rebuild_does_not_clear_the_previous_guide():
    # The half of the same contract that lives in the write itself: while a
    # rebuild runs, the customer keeps reading the guide they already had.
    db = FakeDatabase()
    package, _ = _seed(db)
    db.save_study_materials(package.id, _previous_doc(),
                            "2026-08-01T00:00:00+00:00")

    db.begin_study_generation(package.id)

    row = db.get_study(package.id)
    assert row.status == "generating"
    assert row.doc.source_session_ids == ["sess-old"]


def test_an_unknown_package_is_swallowed_and_recorded_as_failed():
    db = FakeDatabase()

    generate_study_job("missing", db, FakeGenAI([]))

    assert db.get_study("missing").status == "failed"


def test_a_database_write_failure_is_swallowed_and_recorded():
    inner = FakeDatabase()
    package, rows = _seed(inner)
    db = _CountingDatabase(inner, break_save=True)

    generate_study_job(package.id, db, FakeGenAI([_reply([rows[0].id])]))

    assert (db.saves, db.fails) == (1, 1)
    assert inner.get_study(package.id).status == "failed"


def test_a_double_fault_still_never_reaches_the_event_loop():
    # The database is down, so recording the failure fails too. This is the
    # case that decides whether one broken build takes the worker with it.
    inner = FakeDatabase()
    package, rows = _seed(inner)
    db = _CountingDatabase(inner, break_save=True, break_fail=True)

    generate_study_job(package.id, db, FakeGenAI([_reply([rows[0].id])]))

    assert (db.saves, db.fails) == (1, 1)


def test_a_failure_is_logged_with_the_package_id():
    # A build that fails silently is a support ticket with nothing to grep.
    db = FakeDatabase()
    package, _ = _seed(db)
    logger = logging.getLogger("scorer.study.job")
    records: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = records.append
    logger.addHandler(handler)
    try:
        generate_study_job(package.id, db, FakeGenAI([]))
    finally:
        logger.removeHandler(handler)

    assert any(record.exc_info is not None and package.id in record.getMessage()
               for record in records)


@pytest.mark.parametrize("client", [FakeGenAI([]), FakeGenAI(['{"nope": 1}'])])
def test_no_failure_mode_raises(client):
    db = FakeDatabase()
    package, _ = _seed(db)

    generate_study_job(package.id, db, client)   # must simply return

    assert db.get_study(package.id).status == "failed"
