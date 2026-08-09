"""Quick session lifecycle contracts."""
import pytest
from fastapi.testclient import TestClient

from factories import ready_package
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


def test_a_real_quick_room_run_reaches_quick_done():
    # The sequence an actual room produces, not the one a unit test wishes
    # for: the browser mints its realtime secret, beats while the customer
    # talks, and completes when the interviewer says the closing line.
    client, db, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    assert client.post(
        f"/api/sessions/{session_id}/secret-mint", headers=AUTH
    ).status_code == 200
    for _ in range(3):
        assert client.post(
            f"/api/sessions/{session_id}/heartbeat", headers=AUTH
        ).status_code == 200
    response = client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    assert response.status_code == 202
    assert db.get_session(session_id).status == "quick_done"


def test_a_reclaimed_quick_session_resumes_and_still_completes():
    # The room died mid-interview and the customer took the slot back. The
    # re-armed row is the same row, so complete must still land on it.
    client, db, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    client.post(f"/api/sessions/{session_id}/secret-mint", headers=AUTH)
    db.sessions[session_id] = db.sessions[session_id].model_copy(
        update={"status": "abandoned"}
    )
    resumed = client.post("/api/sessions", json={"package_id": package.id}, headers=AUTH)
    assert resumed.status_code == 200
    assert resumed.json()["session_id"] == session_id
    assert resumed.json()["package_kind"] == "quick"
    response = client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    assert response.status_code == 202
    assert db.get_session(session_id).status == "quick_done"


def test_a_standard_complete_without_audio_is_refused_before_the_limiter():
    # audio_path went optional so a quick session can complete with an empty
    # body. The standard session's requirement is now the route's to enforce,
    # and it has to run where pydantic's did: before anything is spent.
    db = FakeDatabase()
    package = ready_package(db, user_id="user-1",
                            paid_at="2026-08-03T00:00:00+00:00")
    client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]

    for _ in range(20):
        refusal = client.post(
            f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
        assert refusal.status_code == 422
    # The budget the empty bodies would have burned is still there.
    accepted = client.post(
        f"/api/sessions/{session_id}/complete",
        json={"audio_path": f"packages/{package.id}/session-1.webm"},
        headers=AUTH,
    )
    assert accepted.status_code == 202
    assert accepted.json()["status"] == "scoring"


def test_replaying_complete_on_a_quick_session_refuses_without_claiming_scoring():
    # A double-tap on End, or the browser retrying its own request. The
    # refusal must not tell a customer their unscored session was scored.
    client, _, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    replay = client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    assert replay.status_code == 409
    assert replay.json()["code"] == "quick-already-done"
    assert "scor" not in replay.json()["error"].lower()


def test_completed_quick_session_is_not_resumable_or_retriable():
    client, _, package = _seed()
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    client.post(f"/api/sessions/{session_id}/complete", json={}, headers=AUTH)
    again = client.post("/api/sessions", json={"package_id": package.id}, headers=AUTH)
    assert again.status_code == 409
    assert again.json()["code"] == "package-exhausted"
