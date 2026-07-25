import json

import httpx
import pytest

from scorer.config import load_product_config
from scorer.evals_l1.golden import (
    TripletDoc,
    TripletGenerationError,
    generate_triplet,
)
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}: vague claims, no example."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}: one example, thin detail."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}: specific, quantified."),
        ],
        signals=[f"{name}: named specifics", f"{name}: measurable outcomes"],
        citations=[
            SourceCitation(
                url="https://example.com/interview-guide",
                title="Example interview guide",
                snippet=f"Interviewers probe {lowered} with follow-up questions.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.3),
            _dim("quantified-impact", "Quantified impact", "content", 0.25),
            _dim("role-knowledge", "Role knowledge", "content", 0.15),
            _dim("pacing-control", "Pacing control", "delivery", 0.15),
            _dim("composure", "Composure", "delivery", 0.15),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?"],
                source="generated",
            ),
            QuestionSpec(
                dimension_key="quantified-impact",
                question="Tell me about a result of yours that you can quantify.",
                probes=["What was the baseline before your change?"],
                source="generated",
            ),
            QuestionSpec(
                dimension_key="role-knowledge",
                question="What does a forward deployed PM own day to day?",
                probes=["Who are your counterparts?"],
                source="generated",
            ),
        ],
        research_summary="Synthetic rubric used only by layer-1 eval tests.",
    )


def _canned_openai_client(payload: dict) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = {"choices": [{"message": {"content": json.dumps(payload)}}]}
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def test_generate_triplet_calls_openai_chat_completions(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric = _make_rubric()
    dimension = rubric.dimensions[0]
    client, seen = _canned_openai_client(
        {"strong": "Strong answer.", "borderline": "Borderline answer.", "weak": "Weak answer."}
    )

    doc = generate_triplet(rubric, dimension, client)

    assert doc == TripletDoc(
        dimension_key="structured-answers",
        question="Walk me through a project you led end to end.",
        strong="Strong answer.",
        borderline="Borderline answer.",
        weak="Weak answer.",
    )
    (request,) = seen
    assert str(request.url) == "https://api.openai.com/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer test-key"
    body = json.loads(request.content)
    assert body["model"] == load_product_config().models.triplet_generator
    assert body["response_format"] == {"type": "json_object"}
    prompt = body["messages"][0]["content"]
    assert dimension.name in prompt
    assert doc.question in prompt
    for anchor in dimension.anchors:
        assert anchor.behavior in prompt
    assert "120-200 words" in prompt


def test_generate_triplet_requires_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    rubric = _make_rubric()
    client, _seen = _canned_openai_client({"strong": "s", "borderline": "b", "weak": "w"})
    with pytest.raises(TripletGenerationError, match="OPENAI_API_KEY"):
        generate_triplet(rubric, rubric.dimensions[0], client)


def test_generate_triplet_requires_question_in_bank(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric = _make_rubric()
    delivery_dim = rubric.dimensions[3]  # pacing-control has no question in the bank
    client, _seen = _canned_openai_client({"strong": "s", "borderline": "b", "weak": "w"})
    with pytest.raises(TripletGenerationError, match="pacing-control"):
        generate_triplet(rubric, delivery_dim, client)
