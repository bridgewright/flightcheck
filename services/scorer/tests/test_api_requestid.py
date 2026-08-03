"""Request-id plumbing: the shared half of F-36.

One id follows a unit of work from the web's inbound request through every
worker call it makes, so a failure in a Railway log can be tied to the
Vercel request that caused it without guessing from timestamps. Phase 0
ships the plumbing; Track C builds the Sentry wiring and the alert rules on
top of it.
"""
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.requestid import (
    REQUEST_ID_HEADER,
    current_request_id,
    install_request_id,
    new_request_id,
    normalize_request_id,
)

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(FakeDatabase(), FakeStorage(), FakeGenAI([])))


# --- id hygiene ----------------------------------------------------------


def test_new_request_id_is_unique_and_acceptable_to_the_normalizer():
    first, second = new_request_id(), new_request_id()
    assert first != second
    assert normalize_request_id(first) == first


@pytest.mark.parametrize("value", [
    None,
    "",
    "   ",
    "has spaces",
    "carriage\r\nreturn",          # response-header injection attempt
    "x" * 129,                     # unbounded id from an upstream caller
    "sémantique",                  # non-latin-1 would break the header write
])
def test_normalize_request_id_refuses_anything_unsafe(value):
    assert normalize_request_id(value) is None


def test_normalize_request_id_trims_and_keeps_a_safe_value():
    assert normalize_request_id("  abc-123._X  ") == "abc-123._X"


# --- middleware ----------------------------------------------------------


def test_response_echoes_the_incoming_request_id(client):
    response = client.get("/healthz", headers={REQUEST_ID_HEADER: "web-req-1"})
    assert response.headers[REQUEST_ID_HEADER] == "web-req-1"


def test_response_carries_a_generated_id_when_none_arrives(client):
    response = client.get("/healthz")
    generated = response.headers[REQUEST_ID_HEADER]
    assert normalize_request_id(generated) == generated


def test_an_unsafe_incoming_id_is_replaced_rather_than_echoed(client):
    response = client.get("/healthz", headers={REQUEST_ID_HEADER: "no spaces here"})
    assert response.headers[REQUEST_ID_HEADER] != "no spaces here"
    assert normalize_request_id(response.headers[REQUEST_ID_HEADER]) is not None


def test_refused_requests_carry_the_id_too(client):
    # The failures worth correlating are exactly the ones that never reach a
    # route: auth refusals, 404s, validation errors.
    for response in (
        client.get("/api/orders", params={"user_id": "u"}),          # 401
        client.get("/api/nope", headers=AUTH),                       # 404
        client.post("/api/sessions", json={}, headers=AUTH),         # 422
    ):
        assert normalize_request_id(response.headers[REQUEST_ID_HEADER]) is not None


# --- log-record binding --------------------------------------------------


def _logging_app() -> FastAPI:
    app = FastAPI()
    install_request_id(app)

    @app.get("/log")
    def log_something() -> dict[str, str]:
        logging.getLogger("scorer.test").info("handling")
        return {"seen": current_request_id() or ""}

    return app


def test_log_records_emitted_during_a_request_carry_the_id(caplog):
    client = TestClient(_logging_app())
    with caplog.at_level(logging.INFO):
        response = client.get("/log", headers={REQUEST_ID_HEADER: "web-req-2"})
    assert response.json() == {"seen": "web-req-2"}
    records = [r for r in caplog.records if r.message == "handling"]
    assert [r.request_id for r in records] == ["web-req-2"]


def test_log_records_outside_a_request_carry_a_placeholder(caplog):
    install_request_id(FastAPI())  # ensure the record factory is installed
    assert current_request_id() is None
    with caplog.at_level(logging.INFO):
        logging.getLogger("scorer.test").info("startup")
    record = next(r for r in caplog.records if r.message == "startup")
    # Never blank and never a fake id: an unattributed line says so.
    assert record.request_id == "-"
