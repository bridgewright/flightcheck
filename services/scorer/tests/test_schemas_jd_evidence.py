"""F-62: RubricDimension.jd_evidence is additive -- stored rubrics parse unchanged.

Every rubric stored since v0.1 predates the field, and api/db.py re-validates
the stored JSON through the current model on every package read. Absence must
behave exactly as today: the model validates, jd_evidence reads back as None,
and renderers show no receipt.
"""
from scorer.schemas import RubricDimension


def _stored_dimension_payload() -> dict:
    """A rubric dimension exactly as stored before F-62: no jd_evidence."""
    return {
        "key": "structured-answers",
        "name": "Structured answers",
        "weight": 0.5,
        "channel": "content",
        "anchors": [
            {"score": 1, "behavior": "Wanders without reaching a conclusion."},
            {"score": 3, "behavior": "Reaches a conclusion when prompted."},
            {"score": 5, "behavior": "Leads with the conclusion unprompted."},
        ],
        "signals": ["answer-first structure"],
        "citations": [
            {
                "url": "https://example.com/interview-guide",
                "title": "Interview guide",
                "snippet": "Lead with the answer.",
            }
        ],
    }


def test_stored_dimension_predating_jd_evidence_still_validates():
    # jd_evidence is defaults-only: every rubric stored before the field
    # existed must keep validating on read and carry None.
    dim = RubricDimension.model_validate(_stored_dimension_payload())
    assert dim.jd_evidence is None
    assert dim.license == "jd"


def test_jd_evidence_round_trips_when_present():
    # The compiler stores the exact JD slice; the schema carries it through
    # unchanged, and serialization emits the key for the web mirror.
    payload = {
        **_stored_dimension_payload(),
        "jd_evidence": "own growth analytics end to end",
    }
    dim = RubricDimension.model_validate(payload)
    assert dim.jd_evidence == "own growth analytics end to end"
    assert dim.model_dump(mode="json")["jd_evidence"] == (
        "own growth analytics end to end"
    )
