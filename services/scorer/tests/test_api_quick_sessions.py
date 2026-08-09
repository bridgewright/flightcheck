"""Quick session lifecycle contracts."""
import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _seed():
    db = FakeDatabase()
    package = db.create_quick_package("user-1", "ACME Labs", "Staff AI Engineer")
    client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))
    return client, db, package


def test_quick_session_uses_quick_plan_and_response_kind():
    client, _, package = _seed()
    response = client.post("/api/sessions", json={"package_id": package.id}, headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["package_kind"] == "quick"
    assert body["session_plan"]["focus"] == "quick"
    assert body["session_plan"]["time_budget_minutes"] == 5
    assert "ACME Labs" in body["interviewer_instructions"]
    assert "Staff AI Engineer" in body["interviewer_instructions"]


def test_quick_session_read_rebuilds_quick_instructions_and_kind():
    client, _, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    body = client.get(f"/api/sessions/{session_id}", headers=AUTH).json()
    assert body["package_kind"] == "quick"
    assert "5-minute quick interview" in body["interviewer_instructions"]


def test_quick_complete_needs_no_upload_and_never_scores():
    client, db, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    response = client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    assert response.status_code == 202
    assert response.json() == {"session_id": session_id, "status": "quick_done"}
    assert db.get_session(session_id).status == "quick_done"
    assert db.get_session(session_id).audio_path is None


def test_completed_quick_session_is_not_resumable_or_retriable():
    client, _, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    again = client.post("/api/sessions", json={"package_id": package.id}, headers=AUTH)
    assert again.status_code == 409
    assert again.json()["code"] == "package-exhausted"
