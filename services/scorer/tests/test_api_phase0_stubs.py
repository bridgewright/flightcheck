"""Phase 0 gave these eight routes 501 stub bodies; every one is now
implemented (F-71 feedback, F-73 coaching, F-74 study) and behaviour-
tested in its own suite. What survives batch-wide is the auth floor:
none of them answers without the worker bearer."""
import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app

TOKEN = "phase0-token"


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
def test_batch2_routes_require_auth(client, method, path):
    assert getattr(client, method)(path).status_code == 401
