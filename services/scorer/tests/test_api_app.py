"""Tests for scorer.api.app -- the HTTP surface, exercised against fakes."""
import json

import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
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
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
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
        research_summary="Synthetic rubric used only by app tests.",
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


def _client(fake: FakeGenAI, storage: FakeStorage | None = None,
            db: FakeDatabase | None = None) -> tuple[TestClient, FakeDatabase]:
    db = db if db is not None else FakeDatabase()
    storage = storage if storage is not None else FakeStorage(corpus=CORPUS)
    return TestClient(create_app(db, storage, fake)), db


def test_healthz_is_public():
    client, _ = _client(FakeGenAI([]))
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_api_routes_reject_missing_or_wrong_token():
    client, _ = _client(FakeGenAI([]))
    assert client.get("/api/packages/by-token/tok-1").status_code == 401
    wrong = {"Authorization": "Bearer wrong-token"}
    assert client.get("/api/packages/by-token/tok-1", headers=wrong).status_code == 401
    assert client.post("/api/packages", json={"jd_text": JD_TEXT}).status_code == 401


def test_post_packages_requires_jd_text_or_url():
    client, _ = _client(FakeGenAI([]))
    response = client.post("/api/packages", json={}, headers=AUTH)
    assert response.status_code == 422


def test_get_package_unknown_token_is_404():
    client, _ = _client(FakeGenAI([]))
    assert client.get("/api/packages/by-token/nope", headers=AUTH).status_code == 404


def test_package_flow_compiles_to_ready():
    client, _db = _client(FakeGenAI(_package_responses()))

    response = client.post(
        "/api/packages",
        json={"jd_text": JD_TEXT, "resume_text": "Alex Example. Senior Product Analyst."},
        headers=AUTH,
    )
    assert response.status_code == 202
    body = response.json()
    assert body["package_id"]
    token = body["access_token"]

    # TestClient runs BackgroundTasks inline, so the compile already finished.
    shown = client.get(f"/api/packages/by-token/{token}", headers=AUTH)
    assert shown.status_code == 200
    package = shown.json()
    assert package["status"] == "ready"
    assert package["rubric"]["role_title"] == "Forward Deployed Product Manager"
    assert package["candidate_profile"]["name"] == "Alex Example"


def test_package_flow_records_failure():
    client, _db = _client(FakeGenAI([]))   # first LLM call raises inside the task
    response = client.post(
        "/api/packages",
        json={"jd_text": JD_TEXT, "resume_text": "resume text"},
        headers=AUTH,
    )
    assert response.status_code == 202
    token = response.json()["access_token"]
    shown = client.get(f"/api/packages/by-token/{token}", headers=AUTH).json()
    assert shown["status"] == "failed"
    assert shown["rubric"] is None
