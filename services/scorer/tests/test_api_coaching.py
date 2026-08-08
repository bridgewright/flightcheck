import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.sessionplan.planner import plan_baseline_session

TOKEN = "coaching-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    db = FakeDatabase()
    package = ready_package(db)
    session = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([]))), session.id


def test_get_defaults_and_patch_round_trip(setup):
    client, session_id = setup
    response = client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["marks"] == {"schema_version": 1, "marks": {}}
    mark = {"reaction": "up", "bookmarked": True}
    patched = client.patch(
        f"/api/sessions/{session_id}/coaching/marks",
        headers=AUTH,
        json={"turn_index": 2, "mark": mark},
    )
    assert patched.status_code == 200
    assert (
        client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH).json()["marks"]["marks"][
            "2"
        ]
        == mark
    )


def test_auth_not_found_and_bad_body(setup):
    client, session_id = setup
    assert client.get(f"/api/sessions/{session_id}/coaching").status_code == 401
    assert client.get("/api/sessions/missing/coaching", headers=AUTH).status_code == 404
    assert (
        client.patch(
            "/api/sessions/missing/coaching/marks",
            headers=AUTH,
            json={"turn_index": 0, "mark": {"reaction": None, "bookmarked": False}},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/sessions/{session_id}/coaching/marks",
            headers=AUTH,
            json={"turn_index": -1, "mark": {"reaction": "sideways", "bookmarked": False}},
        ).status_code
        == 422
    )
