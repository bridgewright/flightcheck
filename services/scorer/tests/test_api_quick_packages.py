"""Contracts for creating capped quick-interview packages."""
import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.config import load_product_config

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _client(db=None):
    database = db or FakeDatabase()
    return TestClient(create_app(database, FakeStorage(), FakeGenAI([]))), database


def test_quick_package_requires_auth_and_user_id():
    client, _ = _client()
    body = {"user_id": "user-1", "company": "Acme", "role": "Engineer"}
    assert client.post("/api/packages/quick", json=body).status_code == 401
    body.pop("user_id")
    assert client.post("/api/packages/quick", json=body, headers=AUTH).status_code == 422


@pytest.mark.parametrize("field", ["company", "role"])
def test_quick_package_trims_and_rejects_empty_inputs(field):
    client, _ = _client()
    body = {"user_id": "user-1", "company": " Acme ", "role": " Engineer "}
    body[field] = "   "
    assert client.post("/api/packages/quick", json=body, headers=AUTH).status_code == 422


def test_quick_package_is_ready_and_preserves_trimmed_inputs():
    client, db = _client()
    response = client.post(
        "/api/packages/quick",
        json={"user_id": "user-1", "company": " Acme Inc. ", "role": " Staff Engineer "},
        headers=AUTH,
    )
    assert response.status_code == 200
    row = db.get_package(response.json()["package_id"])
    assert (row.kind, row.status, row.quick_company, row.quick_role) == (
        "quick", "ready", "Acme Inc.", "Staff Engineer"
    )


def test_quick_lifetime_cap_has_stable_refusal():
    client, db = _client()
    cap = load_product_config().limits.quick_package_cap
    for index in range(cap):
        db.create_quick_package("user-1", f"Company {index}", "Engineer")
    response = client.post(
        "/api/packages/quick",
        json={"user_id": "user-1", "company": "Acme", "role": "Engineer"},
        headers=AUTH,
    )
    assert response.status_code == 409
    assert response.json()["code"] == "quick-cap"


def test_standard_package_ceiling_does_not_block_quick_creation():
    client, db = _client()
    for index in range(load_product_config().limits.max_packages_per_user):
        db.create_package(f"JD {index}", None, user_id="user-1")
    response = client.post(
        "/api/packages/quick",
        json={"user_id": "user-1", "company": "Acme", "role": "Engineer"},
        headers=AUTH,
    )
    assert response.status_code == 200
