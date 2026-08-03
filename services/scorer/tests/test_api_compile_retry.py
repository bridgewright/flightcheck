"""Route contracts for POST /api/packages/{id}/compile-retry (F-30).

A failed compile used to brick the package permanently; the retry endpoint
resets it through the Phase 0 db support and re-enqueues compilation,
capped per package. A retry carries no source documents (they are never
stored), so the profile extracted by the original compile must survive.
"""
import json

import pytest
from fastapi.testclient import TestClient

from factories import make_rubric
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.config import load_product_config
from scorer.schemas import CandidateProfile

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
JD_TEXT = "We are hiring a Senior Product Analyst to own growth analytics."
CORPUS = {"guide.md": "# Guide\nAnchors beat gut feel."}

JD_FACTS_JSON = json.dumps({"role_title": "Senior Product Analyst",
                            "company": None})
FINDINGS_JSON = json.dumps({
    "queries": [], "reported_questions": ["Walk me through a dashboard."],
    "probe_areas": ["metrics"], "evaluation_signals": ["impact"],
    "citations": [],
})


def _compile_script() -> list[str]:
    """Replies for one no-source compile: facts, 2 grounded, findings, rubric."""
    return [JD_FACTS_JSON, "Research prose 1", "Research prose 2",
            FINDINGS_JSON, make_rubric().model_dump_json()]


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _failed_package(db: FakeDatabase, *, with_profile: bool = True):
    row = db.create_package(JD_TEXT, None, user_id="user-1")
    if with_profile:
        db.set_package_profile(row.id, CandidateProfile(
            name="Alex Example", headline="Senior Product Analyst",
            years_experience="4+ years", roles=[], skills=[], achievements=[],
        ))
    db.set_package_rubric(row.id, None, status="failed")
    return db.get_package(row.id)


def _client(db: FakeDatabase, fake: FakeGenAI) -> TestClient:
    return TestClient(create_app(db, FakeStorage(corpus=CORPUS), fake))


def test_retry_recompiles_a_failed_package_and_keeps_the_profile():
    db = FakeDatabase()
    package = _failed_package(db)
    client = _client(db, FakeGenAI(_compile_script()))

    response = client.post(f"/api/packages/{package.id}/compile-retry",
                           headers=AUTH)

    assert response.status_code == 202
    assert response.json() == {"package_id": package.id, "status": "compiling"}
    # TestClient runs BackgroundTasks inline: the recompile already finished.
    updated = db.get_package(package.id)
    assert updated.status == "ready"
    assert updated.rubric is not None
    # The retry had no resume/linkedin sources; the stored profile survives.
    assert updated.candidate_profile is not None
    assert updated.candidate_profile.name == "Alex Example"


def test_retry_refuses_a_package_that_did_not_fail():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None, user_id="user-1")   # "compiling"
    client = _client(db, FakeGenAI([]))

    response = client.post(f"/api/packages/{row.id}/compile-retry",
                           headers=AUTH)

    assert response.status_code == 409
    assert response.json()["code"] == "not-retryable"
    assert db.get_package(row.id).status == "compiling"


def test_retry_caps_per_package(monkeypatch):
    cfg = load_product_config()
    tight = cfg.model_copy(update={
        "limits": cfg.limits.model_copy(update={"compile_retry_cap": 1})
    })
    monkeypatch.setattr("scorer.api.app.load_product_config", lambda: tight)
    db = FakeDatabase()
    package = _failed_package(db)
    # Script only the FIRST retry; a second enqueue would raise IndexError
    # in the background job and flip the row back to "failed".
    client = _client(db, FakeGenAI(_compile_script()))

    assert client.post(f"/api/packages/{package.id}/compile-retry",
                       headers=AUTH).status_code == 202
    db.set_package_rubric(package.id, None, status="failed")

    second = client.post(f"/api/packages/{package.id}/compile-retry",
                         headers=AUTH)
    assert second.status_code == 429
    assert second.json()["code"] == "compile-retry-cap"
    assert db.get_package(package.id).status == "failed"


def test_retry_unknown_package_is_404_and_requires_auth():
    db = FakeDatabase()
    client = _client(db, FakeGenAI([]))
    assert client.post("/api/packages/missing/compile-retry",
                       headers=AUTH).status_code == 404
    assert client.post("/api/packages/missing/compile-retry").status_code == 401
