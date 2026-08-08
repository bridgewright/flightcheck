"""Coaching generation: every claim the model makes is checked against speech.

The product's hardest rule is that a quoted anchor is the candidate's own
words. A model that retypes, paraphrases, or invents a quote must lose the
item, never have it repaired -- a plausible misquote is worse than no quote,
because the whole pitch is that the feedback is arguable against the tape.

Each rule gets its own test on purpose. A single bundled case with a low cap
short-circuits the loop and silently stops exercising the rules it names.
"""
import json

import pytest

from fakes import FakeGenAI
from scorer.coaching.generate import generate_insights, generate_paraphrases
from scorer.schemas import Rubric, SessionReport, TranscriptSegment

# Two candidate turns after grouping: the two consecutive candidate segments
# merge into ordinal 0, and the later one is ordinal 1.
TURN_0 = "I led the launch. It grew revenue."
TURN_1 = "I would measure retention."


def _segments():
    return [
        TranscriptSegment(start_s=0, end_s=1, speaker="interviewer", text="Why?"),
        TranscriptSegment(start_s=1, end_s=2, speaker="candidate", text="I led the launch."),
        TranscriptSegment(start_s=2, end_s=3, speaker="candidate", text="It grew revenue."),
        TranscriptSegment(start_s=3, end_s=4, speaker="interviewer", text="Next?"),
        TranscriptSegment(
            start_s=4, end_s=5, speaker="candidate", text="I would measure retention."
        ),
    ]


def _item(turn_index: int, quote: str, verdict: str = "improve", suggestion: str = "Stronger."):
    return {
        "turn_index": turn_index,
        "verdict": verdict,
        "source_quote": quote,
        "suggestion": suggestion,
        "why": "Names the result up front.",
    }


def _run(items: list[dict], *, max_items: int = 10):
    client = FakeGenAI([json.dumps({"items": items})])
    return generate_paraphrases(_segments(), client, max_items=max_items), client


def test_happy_path_keeps_one_grounded_item_per_turn():
    doc, client = _run([
        _item(0, "grew revenue", verdict="good"),
        _item(1, "measure retention"),
    ])

    assert doc.turn_count == 2
    assert [(item.turn_index, item.verdict) for item in doc.items] == [(0, "good"), (1, "improve")]
    assert [item.source_quote for item in doc.items] == ["grew revenue", "measure retention"]
    assert len(client.calls) == 1          # one batched call, not one per turn


def test_out_of_range_turn_index_is_dropped():
    doc, _ = _run([_item(9, "grew revenue"), _item(0, "grew revenue")])

    assert [item.turn_index for item in doc.items] == [0]


def test_negative_turn_index_is_dropped():
    doc, _ = _run([_item(-1, "grew revenue"), _item(1, "measure retention")])

    assert [item.turn_index for item in doc.items] == [1]


def test_a_quote_that_is_not_in_that_turn_drops_the_item_and_is_never_repaired():
    # The core verbatim contract. "measure retention" is real speech -- but
    # it belongs to turn 1, so claiming it for turn 0 is still a misquote.
    doc, _ = _run([
        _item(0, "a phrase nobody said"),
        _item(1, "measure retention"),
    ])

    assert [item.turn_index for item in doc.items] == [1]
    assert all("nobody said" not in item.source_quote for item in doc.items)


def test_a_quote_borrowed_from_another_turn_drops_the_item():
    doc, _ = _run([_item(0, "measure retention")])

    assert doc.items == []


def test_the_stored_quote_is_the_transcript_slice_not_the_model_retyping():
    # Models re-type quotes with their own capitalisation. The salvage path
    # accepts that, but what gets STORED must be the transcript's own
    # characters -- the web renders the anchor only if it is a substring of
    # the turn, so a retyped quote would silently vanish from the card.
    doc, _ = _run([_item(0, "Grew Revenue")])

    assert [item.source_quote for item in doc.items] == ["grew revenue"]
    assert doc.items[0].source_quote in TURN_0


def test_duplicate_turn_index_keeps_the_first_grounded_item():
    doc, _ = _run([
        _item(0, "grew revenue", suggestion="first"),
        _item(0, "I led", suggestion="second"),
    ])

    assert [item.suggestion for item in doc.items] == ["first"]


def test_a_verdict_outside_the_literal_is_dropped():
    doc, _ = _run([_item(0, "grew revenue", verdict="excellent"), _item(1, "measure retention")])

    assert [item.turn_index for item in doc.items] == [1]


def test_items_are_capped_at_max_items():
    doc, _ = _run([_item(0, "grew revenue"), _item(1, "measure retention")], max_items=1)

    assert [item.turn_index for item in doc.items] == [0]


def test_a_zero_cap_keeps_nothing():
    doc, _ = _run([_item(0, "grew revenue"), _item(1, "measure retention")], max_items=0)

    assert doc.items == []
    assert doc.turn_count == 2          # the count still describes the transcript


def test_turn_count_records_grouped_candidate_turns():
    # The web's drift tripwire compares this against its own grouping, so it
    # must count MERGED turns (2), never raw candidate segments (3).
    doc, _ = _run([])

    assert doc.turn_count == 2


def test_empty_candidate_turns_do_not_call_model():
    client = FakeGenAI([])
    doc = generate_paraphrases([], client, max_items=5)
    assert doc.turn_count == 0
    assert doc.items == []
    assert client.calls == []


def test_candidate_speech_reaches_the_prompt_only_inside_the_fence():
    # F-11a: spoken words are user input. Nothing the candidate said may sit
    # outside the untrusted markers where it would read as instructions.
    doc, client = _run([_item(0, "grew revenue")])
    prompt = client.calls[0]["contents"]
    body = prompt.split("<<<BEGIN UNTRUSTED")[1].split("<<<END UNTRUSTED")[0]

    assert doc.items                       # the call really happened
    assert TURN_0 in body
    assert TURN_1 in body
    assert TURN_0 not in prompt.replace(body, "")


def _insights_payload(**overrides):
    payload = {
        "did_well": ["Named a result."],
        "did_poorly": ["Could quantify more."],
        "must_keep": [{
            "turn_index": 0, "said_verbatim": "grew revenue",
            "better": "It grew revenue 12 percent.", "why": "Clear outcome.",
        }],
        "must_answer": [{
            "question": "What changed?", "model_answer": "Revenue grew.",
            "based_on_quotes": ["grew revenue"],
        }],
    }
    payload.update(overrides)
    return payload


def _insights(payload):
    client = FakeGenAI([json.dumps(payload)])
    report = SessionReport.model_construct(dimension_scores=[], gaps=[])
    rubric = Rubric.model_construct(dimensions=[], question_bank=[])
    return generate_insights(_segments(), report, rubric, client), client


def test_insights_also_fence_candidate_speech():
    # Both generators take the same untrusted input, so both need the fence.
    _doc, client = _insights(_insights_payload())
    prompt = client.calls[0]["contents"]
    body = prompt.split("<<<BEGIN UNTRUSTED")[1].split("<<<END UNTRUSTED")[0]

    assert TURN_0 in body
    assert TURN_0 not in prompt.replace(body, "")


def test_insights_keep_grounded_expressions_and_answers():
    doc, client = _insights(_insights_payload())

    assert doc.did_well == ["Named a result."]
    assert [item.said_verbatim for item in doc.must_keep] == ["grew revenue"]
    assert [item.question for item in doc.must_answer] == ["What changed?"]
    assert len(client.calls) == 1


def test_insights_drop_an_expression_whose_quote_is_not_in_that_turn():
    doc, _ = _insights(_insights_payload(must_keep=[
        {"turn_index": 0, "said_verbatim": "never uttered", "better": "No", "why": "No"},
        {"turn_index": 1, "said_verbatim": "measure retention", "better": "Yes", "why": "Yes"},
    ]))

    assert [item.said_verbatim for item in doc.must_keep] == ["measure retention"]


def test_insights_drop_an_expression_with_an_out_of_range_turn():
    doc, _ = _insights(_insights_payload(must_keep=[
        {"turn_index": 5, "said_verbatim": "grew revenue", "better": "No", "why": "No"},
    ]))

    assert doc.must_keep == []


def test_insights_relocate_the_expression_to_the_transcript_slice():
    doc, _ = _insights(_insights_payload(must_keep=[
        {"turn_index": 0, "said_verbatim": "Grew Revenue", "better": "b", "why": "w"},
    ]))

    assert [item.said_verbatim for item in doc.must_keep] == ["grew revenue"]


def test_insights_drop_an_answer_built_on_a_fabricated_quote():
    doc, _ = _insights(_insights_payload(must_answer=[
        {"question": "Real?", "model_answer": "Yes.", "based_on_quotes": ["grew revenue"]},
        {"question": "Invented?", "model_answer": "No.", "based_on_quotes": ["never spoken"]},
    ]))

    assert [item.question for item in doc.must_answer] == ["Real?"]


def test_insights_drop_an_answer_when_any_one_of_its_quotes_is_fabricated():
    doc, _ = _insights(_insights_payload(must_answer=[
        {"question": "Mixed?", "model_answer": "No.",
         "based_on_quotes": ["grew revenue", "never spoken"]},
    ]))

    assert doc.must_answer == []


@pytest.mark.parametrize("field", ["did_well", "did_poorly"])
def test_insights_bullets_are_capped(field):
    doc, _ = _insights(_insights_payload(**{field: [f"bullet {n}" for n in range(9)]}))

    assert len(getattr(doc, field)) == 4


def test_empty_candidate_turns_skip_insights_model_call():
    client = FakeGenAI([])
    doc = generate_insights([], SessionReport.model_construct(), Rubric.model_construct(), client)
    assert doc.must_answer == []
    assert client.calls == []
