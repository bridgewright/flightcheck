"""F-48: DimensionScore.key_span is additive -- stored reports parse unchanged.

Every report stored since v0.1 predates the field. Absence must behave
exactly as today: the model validates, key_span reads back as None, and
renderers keep their positional first-sentence fallback.
"""
from scorer.schemas import DimensionScore


def _stored_dimension_payload() -> dict:
    """A dimension score exactly as stored before F-48 (and before F-03's
    strengths/weaknesses): no key_span, no strengths, no weaknesses."""
    return {
        "dimension_key": "structured-answers",
        "score": 3.5,
        "evidence_quotes": ["My recommendation was to cut it early."],
        "rationale": "Leads with a conclusion in two of three answers.",
    }


def test_stored_dimension_predating_key_span_still_validates():
    # key_span is defaults-only: every dimension score stored before the
    # field existed must keep validating and read back with the defaults.
    score = DimensionScore.model_validate(_stored_dimension_payload())
    assert score.key_span is None
    assert score.strengths == []
    assert score.weaknesses == []


def test_key_span_round_trips_when_present():
    # The judge marks the span verbatim from its rationale; the schema
    # carries it through unchanged.
    payload = {
        **_stored_dimension_payload(),
        "key_span": "Leads with a conclusion in two of three answers.",
    }
    score = DimensionScore.model_validate(payload)
    assert score.key_span == "Leads with a conclusion in two of three answers."
