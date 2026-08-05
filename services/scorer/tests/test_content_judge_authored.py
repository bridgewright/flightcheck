"""F-48 + F-03b: the content judge authors its emphasis and its lists.

Each judge reply now carries, per dimension, the key span (the ONE clause
or sentence of its own rationale that carries the finding) and the
strengths/weaknesses lists -- all riding the SAME single call per sample;
the cost directive forbids a second model call. The span contract is
enforced in code, not in hope: a returned span that is not a substring of
the rationale it points into is dropped to None and logged at debug,
because a fabricated emphasis is worse than none in a product whose claim
is that its verdicts are honest and arguable.
"""
import json
import logging

from fakes import FakeGenAI
from scorer.content.judge import score_content
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
    TranscriptSegment,
)

_CANDIDATE_LINE = (
    "I led the churn dashboard rollout and we cut churn by 12 percent."
)

_RATIONALE = (
    "Leads with a conclusion and a number. "
    "Detail stays thin in the second half of the answer."
)


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}."),
        ],
        signals=[f"{name}: named specifics"],
        citations=[
            SourceCitation(
                url="https://example.com/guide",
                title="Example guide",
                snippet=f"Interviewers probe {lowered}.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.5),
            _dim("pacing-control", "Pacing control", "delivery", 0.5),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your role?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric for the authored-fields tests.",
    )


def _make_segments() -> list[TranscriptSegment]:
    return [
        TranscriptSegment(
            start_s=0.0,
            end_s=5.0,
            speaker="interviewer",
            text="Tell me about a project you led end to end.",
        ),
        TranscriptSegment(
            start_s=5.5,
            end_s=20.0,
            speaker="candidate",
            text=_CANDIDATE_LINE,
        ),
    ]


def _doc(**overrides) -> dict:
    base = {
        "dimension_key": "structured-answers",
        "score": 4.0,
        "evidence_quotes": [_CANDIDATE_LINE],
        "rationale": _RATIONALE,
    }
    base.update(overrides)
    return base


def _keyed(doc: dict) -> dict[str, list[str]]:
    return {"structured-answers": [json.dumps({"scores": [doc]})] * 3}


def test_verbatim_key_span_is_stored():
    span = "Detail stays thin in the second half of the answer."
    fake = FakeGenAI(keyed_texts=_keyed(_doc(key_span=span)))

    scores = score_content(_make_rubric(), _make_segments(), fake)

    assert scores[0].key_span == span
    # The renderer locates the span by indexOf; the contract is exact.
    assert span in scores[0].rationale


def test_fabricated_key_span_is_dropped_to_none_and_logged(caplog):
    fake = FakeGenAI(
        keyed_texts=_keyed(_doc(key_span="The answer showed no structure at all."))
    )

    with caplog.at_level(logging.DEBUG, logger="scorer.content.judge"):
        scores = score_content(_make_rubric(), _make_segments(), fake)

    assert scores[0].key_span is None
    assert any(
        "key_span" in record.getMessage()
        and "structured-answers" in record.getMessage()
        for record in caplog.records
        if record.levelno == logging.DEBUG
    )


def test_whitespace_normalized_span_is_stored_as_the_exact_substring():
    # The judge collapsed the rationale's line break when copying the span.
    # Whitespace-normalized matching may accept it ONLY by storing the exact
    # substring as it appears in the rationale (indexOf must find it).
    rationale = (
        "Leads with a conclusion.  Detail stays\nthin in the second answer."
    )
    returned = "Detail stays thin in the second answer."
    fake = FakeGenAI(
        keyed_texts=_keyed(_doc(rationale=rationale, key_span=returned))
    )

    scores = score_content(_make_rubric(), _make_segments(), fake)

    stored = scores[0].key_span
    assert stored == "Detail stays\nthin in the second answer."
    assert stored != returned
    assert scores[0].rationale.find(stored) != -1


def test_blank_key_span_reads_as_absent():
    fake = FakeGenAI(keyed_texts=_keyed(_doc(key_span="  ")))
    scores = score_content(_make_rubric(), _make_segments(), fake)
    assert scores[0].key_span is None


def test_strengths_and_weaknesses_ride_the_same_judge_call():
    strengths = ["Named the metric and the timeframe without prompting."]
    weaknesses = ["No alternative approach was weighed before the decision."]
    fake = FakeGenAI(
        keyed_texts=_keyed(_doc(strengths=strengths, weaknesses=weaknesses))
    )

    scores = score_content(_make_rubric(), _make_segments(), fake)

    assert scores[0].strengths == strengths
    assert scores[0].weaknesses == weaknesses
    # ONE judge call per sample, exactly as before: the authored fields must
    # never buy a second model call (cost directive).
    assert len(fake.calls) == 3


def test_old_shape_reply_scores_exactly_as_today():
    # A reply predating the authored fields (no key_span, no strengths, no
    # weaknesses) parses and scores unchanged, reading back the defaults.
    fake = FakeGenAI(keyed_texts=_keyed(_doc()))

    scores = score_content(_make_rubric(), _make_segments(), fake)

    assert scores[0].score == 4.0
    assert scores[0].evidence_quotes == [_CANDIDATE_LINE]
    assert scores[0].rationale == _RATIONALE
    assert scores[0].key_span is None
    assert scores[0].strengths == []
    assert scores[0].weaknesses == []


def test_prompt_instructs_the_authored_fields():
    fake = FakeGenAI(keyed_texts=_keyed(_doc()))
    score_content(_make_rubric(), _make_segments(), fake)
    prompt = fake.calls[0]["contents"]
    assert "key_span" in prompt
    assert "VERBATIM" in prompt
    assert "strengths" in prompt
    assert "weaknesses" in prompt
    # Honest register: a weakness names what was missing, not the person.
    assert "missing" in prompt


def test_key_span_survives_the_no_verifiable_quote_prefix():
    # Fabricated quotes prepend "[no verifiable quote] " to the rationale;
    # the span must still be locatable in the FINAL stored rationale.
    span = "Detail stays thin in the second half of the answer."
    fake = FakeGenAI(
        keyed_texts=_keyed(
            _doc(
                evidence_quotes=["I scaled the platform to ten million users"],
                key_span=span,
            )
        )
    )

    scores = score_content(_make_rubric(), _make_segments(), fake)

    assert scores[0].rationale.startswith("[no verifiable quote] ")
    assert scores[0].key_span == span
    assert span in scores[0].rationale


def test_spokesman_sample_supplies_the_authored_fields():
    # Samples disagree: 4.0, 5.0, 4.4 -> mean 4.47; the authored fields must
    # come from the sample closest to the mean (the third), the same sample
    # that already supplies the rationale and quotes.
    replies = [
        json.dumps({"scores": [_doc(
            score=s,
            rationale=f"Draw {i}: detail stays thin in the second half.",
            key_span=f"Draw {i}: detail stays thin in the second half.",
            strengths=[f"Strength from draw {i}."],
            weaknesses=[f"Weakness from draw {i}."],
        )]})
        for i, s in enumerate((4.0, 5.0, 4.4), start=1)
    ]
    fake = FakeGenAI(keyed_texts={"structured-answers": replies})

    scores = score_content(_make_rubric(), _make_segments(), fake)

    assert scores[0].score == 4.47
    assert scores[0].rationale == "Draw 3: detail stays thin in the second half."
    assert scores[0].key_span == "Draw 3: detail stays thin in the second half."
    assert scores[0].strengths == ["Strength from draw 3."]
    assert scores[0].weaknesses == ["Weakness from draw 3."]
