import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app

TOKEN = "phase0-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    return TestClient(create_app(FakeDatabase(), FakeStorage(), FakeGenAI([])))


@pytest.mark.parametrize("method,path", [
    ("post", "/api/feedback"),
    ("get", "/api/feedback?status=new&limit=5"),
    ("patch", "/api/feedback/feedback-1"),
    ("get", "/api/sessions/session-1/coaching"),
    ("patch", "/api/sessions/session-1/coaching/marks"),
    ("post", "/api/packages/package-1/study"),
    ("get", "/api/packages/package-1/study"),
    ("get", "/api/packages/package-1/bookmarks"),
])
def test_phase0_routes_require_auth_and_return_501(client, method, path):
    assert getattr(client, method)(path).status_code == 401
    response = getattr(client, method)(path, headers=AUTH)
    assert response.status_code == 501
    assert response.json()["code"] == "not-implemented"
