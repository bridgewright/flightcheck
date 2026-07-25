"""Tests for scorer.api.pipeline -- compile and scoring pipelines (offline)."""
import json

import pytest

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.pipeline import compile_package
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)

JD_TEXT = "We are hiring a Senior Product Analyst to own growth analytics."

CORPUS = {"example-public-guide.md": "# Example guide\nBehavioral anchors beat gut feel."}

PROFILE_JSON = json.dumps({
    "name": "Alex Example",
    "headline": "Senior Product Analyst",
    "years_experience": "4+ years",
    "roles": ["Senior Product Analyst, ExampleCorp"],
    "skills": ["SQL", "Python"],
    "achievements": ["Cut dashboard load time 40%"],
})

JD_FACTS_JSON = json.dumps({"role_title": "Senior Product Analyst", "company": None})

FINDINGS_JSON = json.dumps({
    "queries": [],
    "reported_questions": ["Walk me through a dashboard you built end to end."],
    "probe_areas": ["metric definitions"],
    "evaluation_signals": ["quantified impact"],
    "citations": [],
})


@pytest.fixture(autouse=True)
def _isolated_corpus_cache(monkeypatch, tmp_path):
    """Keep the corpus cache inside tmp_path even if the dev env sets it."""
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


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
            _dim("structured-answers", "Structured answers", "content", 0.2),
            _dim("quantified-impact", "Quantified impact", "content", 0.2),
            _dim("role-knowledge", "Role knowledge", "content", 0.2),
            _dim("pacing-control", "Pacing control", "delivery", 0.2),
            _dim("composure", "Composure", "delivery", 0.2),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?", "What was the measurable outcome?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric used only by pipeline tests.",
    )


def _package_responses() -> list[str]:
    """One canned text per generate_content call, in pipeline order."""
    return [
        PROFILE_JSON,                        # build_profile
        JD_FACTS_JSON,                       # jd-facts extraction (company None -> 2 queries)
        "Research prose block 1",            # run_sweep grounded call 1
        "Research prose block 2",            # run_sweep grounded call 2
        FINDINGS_JSON,                       # run_sweep structuring call
        _make_rubric().model_dump_json(),    # compile_rubric
    ]


def test_compile_package_ends_ready_with_rubric_and_profile():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None)
    fake = FakeGenAI(_package_responses())

    compile_package(
        row.id,
        db,
        FakeStorage(corpus=CORPUS),
        fake,
        resume_text="Alex Example. Senior Product Analyst.",
        linkedin_text=None,
    )

    stored = db.get_package(row.id)
    assert stored.status == "ready"
    assert stored.rubric is not None
    assert stored.rubric.role_title == "Forward Deployed Product Manager"
    assert stored.candidate_profile is not None
    assert stored.candidate_profile.name == "Alex Example"
    assert len(fake.calls) == 6


def test_compile_package_without_sources_uses_minimal_profile():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None)
    fake = FakeGenAI(_package_responses()[1:])   # no build_profile call

    compile_package(row.id, db, FakeStorage(corpus=CORPUS), fake)

    stored = db.get_package(row.id)
    assert stored.status == "ready"
    assert stored.candidate_profile is not None
    assert stored.candidate_profile.name is None
    assert stored.candidate_profile.roles == []
    assert len(fake.calls) == 5


def test_compile_package_records_failure_and_swallows():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None)

    # No canned responses: the first LLM call raises. Returning without an
    # exception IS the assertion that compile_package swallowed it.
    compile_package(
        row.id, db, FakeStorage(), FakeGenAI([]),
        resume_text="resume text", linkedin_text=None,
    )

    stored = db.get_package(row.id)
    assert stored.status == "failed"
    assert stored.rubric is None
