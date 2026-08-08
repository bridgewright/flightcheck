"""F-74 study generator: one model call, and the rules it does not get to break.

Two of this generator's outputs are fabricable in ways no schema catches, and
both are checked in code after the model replies rather than asked for in the
prompt:

* A core problem may cite `dimension_keys`. A key that is not in the rubric
  renders as a chip naming a dimension the customer was never scored on.
* A model answer carries `based_on_quotes` -- presented to the customer as
  "you said this". A model that invents one is putting words in their mouth,
  which is the single worst thing this product can do.

Asking the prompt nicely is not a control. These tests exist because the only
control is the code that drops the output.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from factories import make_rubric
from fakes import FakeGenAI
from scorer.study.generate import generate_study

QUOTE = "I led the churn dashboard rollout"
KNOWN_KEY = "structured-answers"


def _package(rubric=None):
    return SimpleNamespace(rubric=make_rubric() if rubric is None else rubric)


def _insights(quote: str = QUOTE) -> dict:
    return {
        "schema_version": 1,
        "generated_at": "2026-08-08T00:00:00+00:00",
        "did_well": ["Opened with the outcome."],
        "did_poorly": ["Left the metric unnamed."],
        "must_keep": [{"turn_index": 2, "said_verbatim": quote,
                       "better": f"{quote}, cutting handle time 18%",
                       "why": "The number is what gets remembered."}],
        "must_answer": [],
    }


def _fact(session_id: str = "sess-1", *, index: int = 1,
          insights: dict | None = None) -> dict:
    """One session as the job assembles it for the prompt."""
    return {"session_id": session_id, "index": index, "overall": 3.2,
            "dimension_scores": [], "gaps": ["Answers stay abstract."],
            "weaknesses": [], "insights": insights}


def _reply(*, problems=None, answers=None, session_ids=("ignored-by-code",)) -> str:
    return json.dumps({
        "schema_version": 1,
        "source_session_ids": list(session_ids),
        "summary": {
            "core_problems": problems if problems is not None else [
                {"title": "Answers stay abstract",
                 "description": "Examples arrive without the number.",
                 "dimension_keys": [KNOWN_KEY]},
            ],
            "improvement_strategy": ["Name the metric first.",
                                     "Rehearse the close.",
                                     "Cut to ninety seconds."],
            "priority_expressions": ["cutting handle time 18%"],
        },
        "jd_core_answers": answers if answers is not None else [
            {"question": "Walk me through a project you led end to end.",
             "dimension_key": KNOWN_KEY,
             "model_answer": "Open with the outcome, then the mechanism.",
             "based_on_quotes": [QUOTE]},
        ],
    })


def _generate(reply: str, facts=None, package=None):
    return generate_study(package or _package(),
                          facts if facts is not None else [_fact(insights=_insights())],
                          FakeGenAI([reply]))


# --- the happy path -------------------------------------------------------


def test_a_grounded_document_survives_intact():
    doc = _generate(_reply())

    assert [problem.title for problem in doc.summary.core_problems] == [
        "Answers stay abstract"]
    assert len(doc.summary.improvement_strategy) == 3
    assert doc.jd_core_answers[0].based_on_quotes == [QUOTE]


def test_one_model_call_carries_the_rubric_and_the_evidence():
    client = FakeGenAI([_reply()])

    generate_study(_package(), [_fact(insights=_insights())], client)

    assert len(client.calls) == 1
    prompt = client.calls[0]["contents"]
    assert KNOWN_KEY in prompt
    assert QUOTE in prompt


def test_candidate_material_is_fenced_as_data():
    # Everything in the payload is text the customer or the model produced.
    # It rides inside a promptsafe fence so a JD that says "ignore your
    # instructions" is quoted rather than obeyed.
    client = FakeGenAI([_reply()])

    generate_study(_package(), [_fact(insights=_insights())], client)

    assert "STUDY_INPUT" in client.calls[0]["contents"]


# --- the two code-side controls -------------------------------------------


def test_a_core_problem_citing_an_unknown_dimension_is_dropped():
    doc = _generate(_reply(problems=[
        {"title": "Real problem", "description": "Grounded in the rubric.",
         "dimension_keys": [KNOWN_KEY]},
        {"title": "Invented problem", "description": "Cites a dimension nobody scored.",
         "dimension_keys": ["executive-presence"]},
    ]))

    assert [problem.title for problem in doc.summary.core_problems] == ["Real problem"]


def test_a_problem_is_dropped_when_any_of_its_keys_is_unknown():
    # Partial grounding is not grounding: the chip row would still name a
    # dimension the customer has no score for.
    doc = _generate(_reply(problems=[
        {"title": "Half invented", "description": "One real key, one invented.",
         "dimension_keys": [KNOWN_KEY, "executive-presence"]},
    ]))

    assert doc.summary.core_problems == []


def test_an_answer_quoting_words_the_candidate_never_said_is_dropped():
    doc = _generate(_reply(answers=[
        {"question": "Walk me through a project you led end to end.",
         "dimension_key": KNOWN_KEY,
         "model_answer": "A plausible answer.",
         "based_on_quotes": ["I single-handedly doubled company revenue"]},
    ]))

    assert doc.jd_core_answers == []


def test_an_answer_is_dropped_when_only_one_of_its_quotes_is_invented():
    doc = _generate(_reply(answers=[
        {"question": "Walk me through a project you led end to end.",
         "dimension_key": KNOWN_KEY,
         "model_answer": "Mostly grounded.",
         "based_on_quotes": [QUOTE, "and then I became CEO"]},
    ]))

    assert doc.jd_core_answers == []


def test_an_answer_citing_an_unknown_dimension_is_dropped():
    doc = _generate(_reply(answers=[
        {"question": "Walk me through a project you led end to end.",
         "dimension_key": "executive-presence",
         "model_answer": "Grounded quote, invented dimension.",
         "based_on_quotes": [QUOTE]},
    ]))

    assert doc.jd_core_answers == []


def test_quote_matching_tolerates_whitespace_and_case():
    # The model re-wraps and re-cases text it copies. Neither changes whether
    # the candidate said it, so neither may drop a real quote.
    doc = _generate(_reply(answers=[
        {"question": "Walk me through a project you led end to end.",
         "dimension_key": KNOWN_KEY,
         "model_answer": "Grounded.",
         "based_on_quotes": ["i led   the\n churn dashboard ROLLOUT"]},
    ]))

    assert len(doc.jd_core_answers) == 1


# --- degrading, and refusing ----------------------------------------------


def test_sessions_without_insights_still_produce_a_document():
    # T4 writes insights; a session scored before it ran has none. The study
    # guide is thinner (no grounded quotes survive) but it still exists.
    doc = _generate(_reply(answers=[]), facts=[_fact(insights=None)])

    assert doc.summary.core_problems != []
    assert doc.source_session_ids == ["sess-1"]


def test_source_session_ids_are_the_consumed_sessions_sorted_not_the_models():
    # The model is asked for a document, not for the provenance. Whatever it
    # echoes back is overwritten -- this list is what the staleness check
    # compares against, so it has to be a fact rather than a claim.
    doc = _generate(
        _reply(session_ids=("sess-hallucinated",)),
        facts=[_fact("sess-9", index=2, insights=_insights()),
               _fact("sess-3", index=1, insights=_insights())],
    )

    assert doc.source_session_ids == ["sess-3", "sess-9"]


def test_zero_scored_sessions_is_refused():
    # The route refuses first; the generator refuses too, so no future caller
    # can produce a study guide about no evidence.
    with pytest.raises(ValueError, match="at least one"):
        generate_study(_package(), [], FakeGenAI([]))


def test_a_package_without_a_rubric_is_refused():
    with pytest.raises(ValueError, match="rubric"):
        generate_study(SimpleNamespace(rubric=None),
                       [_fact(insights=_insights())], FakeGenAI([]))


def test_a_model_document_that_does_not_parse_is_refused():
    with pytest.raises(ValueError, match="invalid document"):
        _generate('{"summary": "not the shape"}')


def test_an_unscored_session_never_reaches_the_model():
    # Guard against a future caller passing raw rows: the generator consumes
    # exactly the facts it is handed, and its provenance says so.
    doc = _generate(_reply(), facts=[_fact("sess-1", insights=_insights())])

    assert doc.source_session_ids == ["sess-1"]
