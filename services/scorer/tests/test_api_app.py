"""Tests for scorer.api.app -- the HTTP surface, exercised against fakes."""
import io
import json

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import (
    BarsAnchor,
    CandidateProfile,
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


SEGMENTS_JSON = json.dumps({"segments": [
    {"start_s": 0.0, "end_s": 1.8, "speaker": "interviewer",
     "text": "Walk me through a project you led end to end."},
    {"start_s": 3.6, "end_s": 7.6, "speaker": "candidate",
     "text": "Um, I led the churn dashboard rollout and we cut churn by 12 percent."},
]})

CONTENT_SCORES_JSON = json.dumps({"scores": [
    {"dimension_key": "structured-answers", "score": 4.0,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": "One clear arc from ownership to outcome, near the score-5 anchor."},
    {"dimension_key": "quantified-impact", "score": 4.5,
     "evidence_quotes": ["we cut churn by 12 percent"],
     "rationale": "Quantified outcome stated directly, matching the score-5 anchor."},
    {"dimension_key": "role-knowledge", "score": 3.5,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": "One concrete example with thin surrounding detail."},
]})

DELIVERY_JUDGE_JSON = json.dumps({
    "scores": [
        {"dimension_key": "pacing-control", "score": 4.0,
         "evidence_quotes": ["03:36-07:36 steady pace"],
         "rationale": "Pace stays steady across the answer window."},
        {"dimension_key": "composure", "score": 4.0,
         "evidence_quotes": ["00:02 pause then structured answer"],
         "rationale": "Signals associated with recovery observed after the opening pause."},
    ],
    "observations": [
        {"at_s": 2.0, "kind": "long-pause",
         "note": "Silence of 1.8 seconds observed before the first answer.",
         "conflicts_with_dsp": False},
    ],
})


def _wav_bytes(duration_s: float = 8.0, sample_rate: int = 16000) -> bytes:
    """Synthesized recording (house rule: no committed audio binaries)."""
    t = np.linspace(0.0, duration_s, int(sample_rate * duration_s), endpoint=False)
    audio = 0.3 * np.sin(2 * np.pi * 220.0 * t)
    audio[int(1.8 * sample_rate):int(3.6 * sample_rate)] = 0.0
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _seed_ready_package(db: FakeDatabase):
    package = db.create_package(JD_TEXT, None)
    db.set_package_profile(
        package.id,
        CandidateProfile(name="Alex Example", headline=None, years_experience=None,
                         roles=[], skills=[], achievements=[]),
    )
    db.set_package_rubric(package.id, _make_rubric(), status="ready")
    return db.get_package(package.id)


def test_session_flow_scores_report():
    db = FakeDatabase()
    package = _seed_ready_package(db)
    audio_path = f"packages/{package.id}/session-1.wav"
    storage = FakeStorage(recordings={audio_path: _wav_bytes()})
    fake = FakeGenAI([SEGMENTS_JSON, CONTENT_SCORES_JSON, DELIVERY_JUDGE_JSON])
    client, _ = _client(fake, storage=storage, db=db)

    created = client.post("/api/sessions", json={"package_id": package.id}, headers=AUTH)
    assert created.status_code == 200
    body = created.json()
    session_id = body["session_id"]
    assert body["session_plan"]["time_budget_minutes"] == 20
    assert "Morgan" in body["interviewer_instructions"]

    completed = client.post(
        f"/api/sessions/{session_id}/complete",
        json={"audio_path": audio_path},
        headers=AUTH,
    )
    assert completed.status_code == 202

    shown = client.get(f"/api/sessions/{session_id}", headers=AUTH)
    assert shown.status_code == 200
    session = shown.json()
    assert session["status"] == "scored"
    assert session["report"]["verdict"] == "ready"
    assert session["report"]["overall_score"] == 4.0
    assert len(session["report"]["dimension_scores"]) == 5
    assert "Morgan" in session["interviewer_instructions"]


def test_get_session_rebuilds_instructions_and_never_stores_them():
    db = FakeDatabase()
    package = _seed_ready_package(db)
    client, _ = _client(FakeGenAI([]), db=db)

    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]

    shown = client.get(f"/api/sessions/{session_id}", headers=AUTH)
    assert shown.status_code == 200
    body = shown.json()
    assert body["interviewer_instructions"]          # present and non-empty
    assert "Morgan" in body["interviewer_instructions"]
    # Rebuilt on every read, never persisted on the session row itself.
    stored = db.get_session(session_id)
    assert "interviewer_instructions" not in stored.model_dump()


def test_session_for_unready_package_is_409():
    db = FakeDatabase()
    package = db.create_package(JD_TEXT, None)   # status "compiling"
    client, _ = _client(FakeGenAI([]), db=db)
    response = client.post("/api/sessions", json={"package_id": package.id}, headers=AUTH)
    assert response.status_code == 409


def test_session_flow_records_failure():
    db = FakeDatabase()
    package = _seed_ready_package(db)
    client, _ = _client(FakeGenAI([]), storage=FakeStorage(), db=db)   # no recording

    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    completed = client.post(
        f"/api/sessions/{session_id}/complete",
        json={"audio_path": "packages/missing.wav"},
        headers=AUTH,
    )
    assert completed.status_code == 202   # the failure happens in the background job

    session = client.get(f"/api/sessions/{session_id}", headers=AUTH).json()
    assert session["status"] == "failed"
    assert session["report"] is None
