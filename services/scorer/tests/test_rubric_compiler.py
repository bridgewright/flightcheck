"""Tests for scorer.rubric.compiler -- structured rubric compilation (no network)."""
import json

import pytest

from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.rubric.compiler import RubricCompileError, compile_rubric
from scorer.rubric.corpus import CorpusDoc
from scorer.schemas import CandidateProfile, ResearchFindings, Rubric, SourceCitation

JD_TEXT = "ExampleCorp is hiring a Senior Product Analyst to own growth analytics."

PROFILE = CandidateProfile(
    name="Alex Example",
    headline="Senior Product Analyst",
    years_experience="4+ years",
    roles=["Senior Product Analyst, ExampleCorp", "Product Analyst, SampleWorks"],
    skills=["SQL", "Python", "experiment design"],
    achievements=["Cut dashboard load time 40%"],
)

FINDINGS = ResearchFindings(
    queries=["ExampleCorp Senior Product Analyst interview questions"],
    reported_questions=["Walk me through a dashboard you built end to end."],
    probe_areas=["metric definitions", "stakeholder pushback"],
    evaluation_signals=["quantified impact", "structured answers"],
    citations=[
        SourceCitation(
            url="https://glassdoor.example.com/r1",
            title="Interview review",
            snippet="asked about metrics",
        )
    ],
)

CORPUS = [
    CorpusDoc(
        doc_id="style-guide",
        title="Answer style guide",
        text="Lead with the outcome, then the method.",
    ),
    CorpusDoc(doc_id="long-doc", title="Long corpus doc", text="B" * 2500),
]


def _dim_dict(key: str, name: str, channel: str, weight: float) -> dict:
    lowered = name.lower()
    return {
        "key": key,
        "name": name,
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": f"Fails to show {lowered}: vague claims, no example."},
            {"score": 3, "behavior": f"Shows some {lowered}: one example, thin detail."},
            {"score": 5, "behavior": f"Consistently shows {lowered}: specific, quantified."},
        ],
        "signals": [f"{name}: named specifics"],
        "citations": [{
            "url": "https://glassdoor.example.com/r1",
            "title": "Interview review",
            "snippet": "asked about metrics",
        }],
    }


def _rubric_dict(role_title: str = "Senior Product Analyst") -> dict:
    return {
        "role_title": role_title,
        "company": "ExampleCorp",
        "dimensions": [
            _dim_dict("structured-answers", "Structured answers", "content", 0.3),
            _dim_dict("quantified-impact", "Quantified impact", "content", 0.25),
            _dim_dict("role-knowledge", "Role knowledge", "content", 0.2),
            _dim_dict("pacing-control", "Pacing control", "delivery", 0.15),
            _dim_dict("composure", "Composure", "delivery", 0.1),
        ],
        "question_bank": [{
            "dimension_key": "structured-answers",
            "question": "Walk me through a dashboard you built end to end.",
            "probes": ["What was your specific role?"],
            "source": "research-sweep",
        }],
        "research_summary": "Synthetic rubric used by compiler tests.",
    }


def _fewshot(role_title: str) -> Rubric:
    return Rubric.model_validate(_rubric_dict(role_title))


def _compile(fake: FakeGenAI, fewshots: list[Rubric] | None = None) -> Rubric:
    return compile_rubric(JD_TEXT, PROFILE, FINDINGS, CORPUS, fewshots or [], fake)


def test_compile_rubric_returns_validated_rubric():
    fake = FakeGenAI([json.dumps(_rubric_dict())])
    rubric = _compile(fake)
    assert isinstance(rubric, Rubric)
    assert rubric.role_title == "Senior Product Analyst"
    assert len(rubric.dimensions) == 5


def test_compile_rubric_makes_one_structured_call():
    fake = FakeGenAI([json.dumps(_rubric_dict())])
    _compile(fake)
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["model"] == load_product_config().models.scorer
    config = call["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema is Rubric


def test_prompt_carries_jd_profile_and_findings():
    fake = FakeGenAI([json.dumps(_rubric_dict())])
    _compile(fake)
    prompt = fake.calls[0]["contents"]
    assert JD_TEXT in prompt
    assert "Alex Example" in prompt
    assert "4+ years" in prompt
    assert "Walk me through a dashboard you built end to end." in prompt
    assert "metric definitions" in prompt
    assert "quantified impact" in prompt
    assert "https://glassdoor.example.com/r1" in prompt


def test_prompt_carries_corpus_excerpts_with_doc_id_headers_truncated():
    fake = FakeGenAI([json.dumps(_rubric_dict())])
    _compile(fake)
    prompt = fake.calls[0]["contents"]
    assert "corpus://style-guide" in prompt
    assert "Answer style guide" in prompt
    assert "Lead with the outcome, then the method." in prompt
    assert "corpus://long-doc" in prompt
    assert "B" * 2000 in prompt
    assert "B" * 2001 not in prompt


def test_prompt_carries_at_most_two_fewshots():
    fewshots = [
        _fewshot("Fewshot Role Zero"),
        _fewshot("Fewshot Role One"),
        _fewshot("Fewshot Role Two"),
    ]
    fake = FakeGenAI([json.dumps(_rubric_dict())])
    _compile(fake, fewshots)
    prompt = fake.calls[0]["contents"]
    assert "Fewshot Role Zero" in prompt
    assert "Fewshot Role One" in prompt
    assert "Fewshot Role Two" not in prompt


def test_prompt_states_the_strict_rules():
    fake = FakeGenAI([json.dumps(_rubric_dict())])
    _compile(fake)
    prompt = fake.calls[0]["contents"]
    assert "5 to 8 dimensions" in prompt
    assert 'channel "delivery"' in prompt
    assert '"corpus://<doc_id>"' in prompt
    assert "question-independent" in prompt
    assert "research-sweep" in prompt


def _citationless_rubric_dict() -> dict:
    doc = _rubric_dict()
    doc["dimensions"][0]["citations"] = []
    return doc


def test_invalid_first_response_retries_once_with_error_text():
    fake = FakeGenAI([json.dumps(_citationless_rubric_dict()), json.dumps(_rubric_dict())])
    rubric = _compile(fake)
    assert isinstance(rubric, Rubric)
    assert len(fake.calls) == 2
    first_prompt = fake.calls[0]["contents"]
    retry_prompt = fake.calls[1]["contents"]
    assert retry_prompt.startswith(first_prompt)
    appended = retry_prompt[len(first_prompt):]
    assert "PREVIOUS ATTEMPT FAILED VALIDATION" in appended
    assert "validation error" in appended  # the pydantic ValidationError text is embedded
    assert fake.calls[1]["config"].response_schema is Rubric


def test_malformed_json_first_response_also_retries():
    fake = FakeGenAI(["this is not json", json.dumps(_rubric_dict())])
    rubric = _compile(fake)
    assert isinstance(rubric, Rubric)
    assert len(fake.calls) == 2


def test_two_invalid_responses_raise_rubric_compile_error():
    fake = FakeGenAI([
        json.dumps(_citationless_rubric_dict()),
        json.dumps(_citationless_rubric_dict()),
    ])
    with pytest.raises(RubricCompileError):
        _compile(fake)
    assert len(fake.calls) == 2
