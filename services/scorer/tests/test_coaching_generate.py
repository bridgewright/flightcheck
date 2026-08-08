import json

from fakes import FakeGenAI
from scorer.coaching.generate import generate_insights, generate_paraphrases
from scorer.schemas import Rubric, SessionReport, TranscriptSegment


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


def test_paraphrases_validate_quotes_indices_duplicates_verdict_and_cap():
    payload = {
        "items": [
            {
                "turn_index": 0,
                "verdict": "good",
                "source_quote": "grew revenue",
                "suggestion": "I led the launch, growing revenue.",
                "why": "Keeps the result.",
            },
            {
                "turn_index": 0,
                "verdict": "improve",
                "source_quote": "I led",
                "suggestion": "duplicate",
                "why": "duplicate",
            },
            {
                "turn_index": 9,
                "verdict": "good",
                "source_quote": "I led",
                "suggestion": "bad index",
                "why": "bad",
            },
            {
                "turn_index": 1,
                "verdict": "bad",
                "source_quote": "retention",
                "suggestion": "bad verdict",
                "why": "bad",
            },
            {
                "turn_index": 1,
                "verdict": "improve",
                "source_quote": "fabricated",
                "suggestion": "bad quote",
                "why": "bad",
            },
            {
                "turn_index": 1,
                "verdict": "improve",
                "source_quote": "measure retention",
                "suggestion": "I would define and measure retention.",
                "why": "Adds specificity.",
            },
        ]
    }
    client = FakeGenAI([json.dumps(payload)])

    doc = generate_paraphrases(_segments(), client, max_items=1)

    assert doc.turn_count == 2
    assert len(doc.items) == 1
    assert doc.items[0].source_quote == "grew revenue"
    assert len(client.calls) == 1


def test_empty_candidate_turns_do_not_call_model():
    client = FakeGenAI([])
    doc = generate_paraphrases([], client, max_items=5)
    assert doc.turn_count == 0
    assert doc.items == []
    assert client.calls == []


def test_insights_ground_verbatim_fields_and_drop_fabricated_answers():
    payload = {
        "did_well": ["Named a result."],
        "did_poorly": ["Could quantify more."],
        "must_keep": [
            {
                "turn_index": 0,
                "said_verbatim": "grew revenue",
                "better": "It grew revenue.",
                "why": "Clear outcome.",
            },
            {"turn_index": 5, "said_verbatim": "invented", "better": "No", "why": "No"},
        ],
        "must_answer": [
            {
                "question": "What changed?",
                "model_answer": "Revenue grew.",
                "based_on_quotes": ["grew revenue"],
            },
            {"question": "Fabricated?", "model_answer": "No.", "based_on_quotes": ["not spoken"]},
        ],
    }
    client = FakeGenAI([json.dumps(payload)])
    report = SessionReport.model_construct(dimension_scores=[], gaps=[])
    rubric = Rubric.model_construct(dimensions=[], question_bank=[])

    doc = generate_insights(_segments(), report, rubric, client)

    assert [item.said_verbatim for item in doc.must_keep] == ["grew revenue"]
    assert [item.question for item in doc.must_answer] == ["What changed?"]


def test_empty_candidate_turns_skip_insights_model_call():
    client = FakeGenAI([])
    doc = generate_insights([], SessionReport.model_construct(), Rubric.model_construct(), client)
    assert doc.must_answer == []
    assert client.calls == []
