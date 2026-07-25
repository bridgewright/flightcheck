"""Tests for scorer.schemas -- rubric integrity validators and strict models."""
import pytest
from pydantic import ValidationError

from scorer.schemas import Rubric, SourceCitation

CITATION = {
    "url": "https://example.com/interview-guide",
    "title": "Example interview guide",
    "snippet": "Interviewers probe for specifics with follow-up questions.",
}


def _anchors(scores=(1, 3, 5)) -> list[dict]:
    return [{"score": s, "behavior": f"Anchor behavior for score {s}."} for s in scores]


def _dim(key: str, channel: str, weight: float, *,
         citations=None, anchors=None) -> dict:
    return {
        "key": key,
        "name": key.replace("-", " ").title(),
        "weight": weight,
        "channel": channel,
        "anchors": _anchors() if anchors is None else anchors,
        "signals": [f"{key}: named specifics"],
        "citations": [CITATION] if citations is None else citations,
    }


def _rubric(dimensions: list[dict]) -> Rubric:
    return Rubric.model_validate({
        "role_title": "Forward Deployed Product Manager",
        "company": "ExampleCo",
        "dimensions": dimensions,
        "question_bank": [{
            "dimension_key": dimensions[0]["key"],
            "question": "Walk me through a project you led end to end.",
            "probes": ["What was your specific role?"],
            "source": "generated",
        }],
        "research_summary": "Synthetic rubric for schema tests.",
    })


def test_valid_rubric_accepted():
    rubric = _rubric([
        _dim("structured-answers", "content", 0.4),
        _dim("quantified-impact", "content", 0.3),
        _dim("pacing-control", "delivery", 0.3),
    ])
    assert [d.key for d in rubric.dimensions] == [
        "structured-answers", "quantified-impact", "pacing-control"]
    assert rubric.dimensions[2].channel == "delivery"


def test_weights_within_tolerance_accepted():
    rubric = _rubric([
        _dim("structured-answers", "content", 0.502),
        _dim("pacing-control", "delivery", 0.503),
    ])
    assert abs(sum(d.weight for d in rubric.dimensions) - 1.0) <= 0.01


def test_weights_off_by_more_than_tolerance_rejected():
    with pytest.raises(ValidationError, match="must sum to 1"):
        _rubric([
            _dim("structured-answers", "content", 0.5),
            _dim("pacing-control", "delivery", 0.4),
        ])


def test_citation_less_dimension_rejected():
    with pytest.raises(ValidationError, match="citation"):
        _rubric([
            _dim("structured-answers", "content", 0.5, citations=[]),
            _dim("pacing-control", "delivery", 0.5),
        ])


def test_wrong_anchor_scores_rejected():
    with pytest.raises(ValidationError, match="scores 1, 3, 5"):
        _rubric([
            _dim("structured-answers", "content", 0.5, anchors=_anchors((1, 2, 5))),
            _dim("pacing-control", "delivery", 0.5),
        ])


def test_missing_anchor_rejected():
    with pytest.raises(ValidationError, match="scores 1, 3, 5"):
        _rubric([
            _dim("structured-answers", "content", 0.5, anchors=_anchors((1, 3))),
            _dim("pacing-control", "delivery", 0.5),
        ])


def test_duplicate_anchor_scores_rejected():
    with pytest.raises(ValidationError, match="scores 1, 3, 5"):
        _rubric([
            _dim("structured-answers", "content", 0.5, anchors=_anchors((1, 3, 3))),
            _dim("pacing-control", "delivery", 0.5),
        ])


def test_rubric_without_delivery_dimension_rejected():
    with pytest.raises(ValidationError, match="delivery"):
        _rubric([
            _dim("structured-answers", "content", 0.5),
            _dim("quantified-impact", "content", 0.5),
        ])


def test_models_forbid_extra_fields():
    with pytest.raises(ValidationError):
        SourceCitation.model_validate({**CITATION, "rank": 1})
