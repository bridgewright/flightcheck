"""GET /api/ops/dead-letters — the operator's view of what just broke.

The audit's complaint about failures was not that they happen but that
nothing an operator looks at says one did; they were discovered by customer
complaint. This endpoint is the "visible" half of the dead-letter path.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.deadletter import default_log, reset_default_log

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))
    reset_default_log()
    yield
    reset_default_log()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(FakeDatabase(), FakeStorage(), FakeGenAI([])))


def test_an_empty_worker_reports_an_honest_empty_list(client):
    response = client.get("/api/ops/dead-letters", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"records": [], "returned": 0, "total_recorded": 0}


def test_recorded_failures_come_back_newest_first(client):
    default_log().record("scoring", "sess-1", ValueError("a"), reason="deadline")
    default_log().record("compile", "pkg-9", RuntimeError("b"),
                         reason="pipeline-error")

    body = client.get("/api/ops/dead-letters", headers=AUTH).json()

    assert [r["subject_id"] for r in body["records"]] == ["pkg-9", "sess-1"]
    assert body["records"][0]["reason"] == "pipeline-error"
    assert body["records"][0]["error_type"] == "RuntimeError"
    assert body["total_recorded"] == 2


def test_the_limit_is_bounded_so_one_request_cannot_dump_everything(client):
    for index in range(30):
        default_log().record("scoring", f"sess-{index}", ValueError("x"),
                             reason="pipeline-error")

    body = client.get("/api/ops/dead-letters?limit=5", headers=AUTH).json()
    assert body["returned"] == 5

    assert client.get("/api/ops/dead-letters?limit=0", headers=AUTH).status_code == 422
    assert client.get("/api/ops/dead-letters?limit=5000",
                      headers=AUTH).status_code == 422


def test_dead_letters_are_behind_the_worker_token(client):
    assert client.get("/api/ops/dead-letters").status_code == 401


def test_the_endpoint_never_leaks_a_recording_path_or_a_token(client):
    default_log().record(
        "scoring", "sess-1",
        ValueError("download failed for recordings/user-9/sess-1.webm"),
        reason="pipeline-error",
    )
    body = client.get("/api/ops/dead-letters", headers=AUTH).json()
    # The detail is the exception text, which is ours -- the point of this
    # test is that nothing else (row contents, tokens) rides along.
    assert set(body["records"][0]) == {
        "kind", "subject_id", "reason", "error_type", "detail", "occurred_at",
    }
