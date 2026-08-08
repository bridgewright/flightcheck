"""The coaching hook: generated after the verdict, never able to spoil it.

Coaching is an extra artifact hung off a run that already succeeded, so
every test here asks the same question from a different angle -- can this
hook change the outcome of scoring? It must not: not the status, not the
report, not the stage marker, not the dead-letter log.
"""
import json

import pytest
from test_api_pipeline import (
    CONTENT_SCORES_JSONS,
    DELIVERY_JUDGE_JSON,
    SEGMENTS_JSON,
    _seed_scorable_session,
    _wav_bytes,
)

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.deadletter import default_log, reset_default_log
from scorer.api.pipeline import score_session

# The canned transcript holds exactly one candidate turn, so turn_count is 1
# and ordinal 0 is the only addressable turn.
PARAPHRASES_JSON = json.dumps({"items": [{
    "turn_index": 0,
    "verdict": "improve",
    "source_quote": "we cut churn by 12 percent",
    "suggestion": "I led the churn dashboard rollout, and it cut churn 12 percent.",
    "why": "Drops the filler opener and puts the result in the main clause.",
}]})

INSIGHTS_JSON = json.dumps({
    "did_well": ["Named a quantified outcome."],
    "did_poorly": ["Opened with a filler word."],
    "must_keep": [{
        "turn_index": 0,
        "said_verbatim": "cut churn by 12 percent",
        "better": "cut churn 12 percent in two quarters",
        "why": "Adds the time frame the number needs.",
    }],
    "must_answer": [{
        "question": "How did you measure churn?",
        "model_answer": "Monthly, on the dashboard I built.",
        "based_on_quotes": ["churn dashboard rollout"],
    }],
})

SCORED_SCRIPT = [SEGMENTS_JSON, *CONTENT_SCORES_JSONS, DELIVERY_JUDGE_JSON]
FULL_SCRIPT = [*SCORED_SCRIPT, PARAPHRASES_JSON, INSIGHTS_JSON]


@pytest.fixture(autouse=True)
def _fresh_deadletter():
    reset_default_log()
    yield
    reset_default_log()


def _run(db: FakeDatabase, script: list[str]):
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    fake = FakeGenAI(script)
    return session, fake, score_session(session.id, db, storage, fake)


def test_coaching_is_generated_and_saved_for_a_scored_session(permissive_eligibility):
    db = FakeDatabase()
    session, fake, report = _run(db, FULL_SCRIPT)

    assert report is not None
    assert db.get_session(session.id).status == "scored"
    paraphrases = db.get_session_paraphrases(session.id)
    assert paraphrases is not None
    assert paraphrases.turn_count == 1
    # The stored quote is the transcript's own slice, not the model's retyping.
    assert paraphrases.items[0].source_quote == "we cut churn by 12 percent"
    insights = db.get_session_insights(session.id)
    assert insights is not None
    assert [item.said_verbatim for item in insights.must_keep] == ["cut churn by 12 percent"]
    assert [item.question for item in insights.must_answer] == ["How did you measure churn?"]
    # Two extra calls beyond the scoring script: one batched call per artifact.
    assert len(fake.calls) == len(SCORED_SCRIPT) + 2


def test_coaching_is_generated_for_a_limited_session(monkeypatch):
    # F-04: a limited session is a scored session with thinner evidence. It
    # still gets coaching -- the candidate spoke, so there is speech to coach.
    from scorer.config import load_product_config as real_load
    cfg = real_load()
    monkeypatch.setattr("scorer.api.pipeline.load_product_config", lambda: cfg.model_copy(
        update={"eligibility": cfg.eligibility.model_copy(update={
            "min_duration_s": 0.0, "min_candidate_turns": 0, "min_candidate_words": 0,
        })}
    ))
    db = FakeDatabase()
    session, _fake, report = _run(db, FULL_SCRIPT)

    assert report is not None
    assert report.eligibility == "limited"
    assert db.get_session_paraphrases(session.id) is not None
    assert db.get_session_insights(session.id) is not None


def test_insufficient_session_spends_nothing_on_coaching():
    # The no-spend posture: below the floors the run stops before the judges,
    # and coaching -- two more paid calls -- must stop with them. Only the
    # transcribe reply is scripted, so any further call raises IndexError.
    db = FakeDatabase()
    session, fake, result = _run(db, [SEGMENTS_JSON])

    assert result is None
    assert db.get_session(session.id).status == "insufficient"
    assert len(fake.calls) == 1
    assert db.get_session_paraphrases(session.id) is None
    assert db.get_session_insights(session.id) is None


def test_a_raising_generator_leaves_the_run_green_and_the_report_saved(
    permissive_eligibility,
):
    # The whole point of the hook's placement. The script stops after the
    # delivery judge, so BOTH coaching calls exhaust it and raise IndexError.
    db = FakeDatabase()
    session, _fake, report = _run(db, SCORED_SCRIPT)

    assert report is not None                       # the run still returns
    stored = db.get_session(session.id)
    assert stored.status == "scored"                # and stays scored
    assert stored.report is not None                # with the report saved
    assert stored.report.verdict == report.verdict
    assert db.get_session_paraphrases(session.id) is None   # only the artifact is missing
    assert db.get_session_insights(session.id) is None
    # A failure here is a log line, never a dead letter: nothing to retry,
    # because the session the operator would retry already succeeded.
    assert default_log().recent() == []


def test_coaching_failure_is_logged_against_the_session(permissive_eligibility, caplog):
    import logging
    db = FakeDatabase()
    with caplog.at_level(logging.ERROR, logger="scorer.api.pipeline"):
        session, _fake, _report = _run(db, SCORED_SCRIPT)
    messages = [record.getMessage() for record in caplog.records]
    assert any("paraphrase generation failed" in message for message in messages)
    assert any("insights generation failed" in message for message in messages)
    assert all(session.id in message for message in messages)


def test_the_hook_touches_neither_the_stage_marker_nor_the_marks(permissive_eligibility):
    db = FakeDatabase()
    session, _fake, _report = _run(db, FULL_SCRIPT)

    # Same stage progression as a run without coaching: the hook adds no stage.
    assert db.stage_writes == [
        (session.id, "download"),
        (session.id, "transcribe"),
        (session.id, "delivery-metrics"),
        (session.id, "content-judge"),
        (session.id, "delivery-judge"),
        (session.id, "compile"),
    ]
    assert db.get_session(session.id).scoring_stage is None
    # Marks are the reader's, never the generator's.
    assert db.get_paraphrase_marks(session.id).marks == {}
