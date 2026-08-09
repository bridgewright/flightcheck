"""Route contracts for the v0.5 trial/paid quota chokepoint (F-24/F-25).

Covers: trial marking at package create, effective totals (1 until paid),
the distinct 410 expiry rejection vs the 409 exhaustion, slot-consuming
session accounting, and the trial/paid/expiry fields on every summary
surface the web renders from.
"""
import json

import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
JD_TEXT = "We are hiring a Senior Product Analyst to own growth analytics."

PROFILE_JSON = json.dumps({
    "name": "Alex Example", "headline": None, "years_experience": None,
    "roles": [], "skills": [], "achievements": [],
})


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _client(db: FakeDatabase | None = None,
            fake: FakeGenAI | None = None) -> tuple[TestClient, FakeDatabase]:
    db = db if db is not None else FakeDatabase()
    return TestClient(create_app(db, FakeStorage(), fake or FakeGenAI([]))), db


# --- trial marking at create ---------------------------------------------


def test_new_standard_package_is_not_a_trial():
    client, db = _client(fake=FakeGenAI([]))   # compile fails; row still lands
    response = client.post(
        "/api/packages", json={"jd_text": JD_TEXT, "user_id": "user-1"},
        headers=AUTH,
    )
    assert response.status_code == 202
    assert db.get_package(response.json()["package_id"]).is_trial is False


def test_second_package_for_the_same_user_is_not_trial():
    db = FakeDatabase()
    db.create_package(JD_TEXT, None, user_id="user-1")
    client, _ = _client(db=db, fake=FakeGenAI([]))
    response = client.post(
        "/api/packages", json={"jd_text": f"{JD_TEXT} v2", "user_id": "user-1"},
        headers=AUTH,
    )
    assert response.status_code == 202
    assert db.get_package(response.json()["package_id"]).is_trial is False


def test_unowned_package_is_never_trial():
    client, db = _client(fake=FakeGenAI([]))
    response = client.post(
        "/api/packages", json={"jd_text": JD_TEXT}, headers=AUTH,
    )
    assert response.status_code == 202
    assert db.get_package(response.json()["package_id"]).is_trial is False


def test_created_package_rows_carry_a_fresh_updated_at():
    # Born touched: a compile that dies before its first status write must
    # still be visible to the stuck-state reaper, and the reaper skips NULL
    # updated_at rows -- so creation itself stamps the clock.
    client, db = _client(fake=FakeGenAI([]))
    response = client.post(
        "/api/packages", json={"jd_text": JD_TEXT, "user_id": "user-1"},
        headers=AUTH,
    )
    assert db.get_package(response.json()["package_id"]).updated_at is not None


# --- quota chokepoint: 1 until paid --------------------------------------


def test_unpaid_package_exposes_exactly_one_session():
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    client, _ = _client(db=db)

    first = client.post("/api/sessions", json={"package_id": package.id},
                        headers=AUTH)
    assert first.status_code == 200
    db.set_session_status(first.json()["session_id"], "scored")

    second = client.post("/api/sessions", json={"package_id": package.id},
                         headers=AUTH)
    assert second.status_code == 409
    assert second.json() == {
        "error": "package exhausted: the included session is used",
        "code": "package-exhausted",
    }


def test_paid_package_exposes_its_full_total():
    db = FakeDatabase()
    package = ready_package(db, is_trial=True,
                            paid_at="2026-08-03T00:00:00+00:00",
                            expires_at="2026-09-02T00:00:00+00:00",
                            total_sessions=2)
    client, _ = _client(db=db)

    first = client.post("/api/sessions", json={"package_id": package.id},
                        headers=AUTH)
    db.set_session_status(first.json()["session_id"], "scored")
    second = client.post("/api/sessions", json={"package_id": package.id},
                         headers=AUTH)
    assert second.status_code == 200
    assert second.json()["index"] == 2
    db.set_session_status(second.json()["session_id"], "scored")

    third = client.post("/api/sessions", json={"package_id": package.id},
                        headers=AUTH)
    assert third.status_code == 409
    assert third.json() == {
        "error": "package exhausted: all 2 sessions used",
        "code": "package-exhausted",
    }


def test_failed_and_insufficient_rows_do_not_consume_the_quota():
    # The "Complete pill + Start session 6" bug, server half: a failed row
    # keeps its slot, so it must be resumed instead of tripping exhaustion.
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    client, _ = _client(db=db)
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=AUTH
    ).json()["session_id"]
    db.set_session_status(session_id, "failed")

    again = client.post("/api/sessions", json={"package_id": package.id},
                        headers=AUTH)
    assert again.status_code == 200
    assert again.json()["session_id"] == session_id


# --- expiry: a distinct 410, create-only ---------------------------------


def test_expired_package_rejects_new_sessions_with_410():
    db = FakeDatabase()
    package = ready_package(db, paid_at="2026-06-01T00:00:00+00:00",
                            expires_at="2026-07-01T00:00:00+00:00")
    client, _ = _client(db=db)

    response = client.post("/api/sessions", json={"package_id": package.id},
                           headers=AUTH)
    assert response.status_code == 410
    body = response.json()
    assert body["code"] == "package-expired"
    assert "expired" in body["error"]


def test_expired_package_blocks_resumes_too():
    db = FakeDatabase()
    package = ready_package(db, paid_at="2026-06-01T00:00:00+00:00",
                            expires_at="2026-07-01T00:00:00+00:00")
    row = db.create_session(package.id, 1, None)
    db.set_session_status(row.id, "failed")
    client, _ = _client(db=db)

    response = client.post("/api/sessions", json={"package_id": package.id},
                           headers=AUTH)
    assert response.status_code == 410
    assert response.json()["code"] == "package-expired"


def test_expiry_never_blocks_reads_or_artifacts():
    db = FakeDatabase()
    package = ready_package(db, paid_at="2026-06-01T00:00:00+00:00",
                            expires_at="2026-07-01T00:00:00+00:00")
    row = db.create_session(package.id, 1, None)
    db.set_session_status(row.id, "scored")
    client, _ = _client(db=db)

    assert client.get(f"/api/packages/by-token/{package.access_token}",
                      headers=AUTH).status_code == 200
    assert client.get(f"/api/packages/{package.id}/sessions",
                      headers=AUTH).status_code == 200
    assert client.get(f"/api/packages/{package.id}/progress",
                      headers=AUTH).status_code == 200
    assert client.get(f"/api/sessions/{row.id}", headers=AUTH).status_code == 200


def test_trial_without_paid_at_never_expires():
    # Trial packages get no expires_at until payment sets one; the quota
    # answer must be exhaustion (buy), never expiry (dead end).
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    row = db.create_session(package.id, 1, None)
    db.set_session_status(row.id, "scored")
    client, _ = _client(db=db)

    response = client.post("/api/sessions", json={"package_id": package.id},
                           headers=AUTH)
    assert response.status_code == 409
    assert response.json()["code"] == "package-exhausted"


# --- summaries expose trial/paid/expiry state -----------------------------


def test_user_package_summaries_expose_payment_state_and_honest_usage():
    db = FakeDatabase()
    package = ready_package(db, user_id="user-1", is_trial=True,
                            paid_at="2026-08-03T00:00:00+00:00",
                            expires_at="2026-09-02T00:00:00+00:00")
    scored = db.create_session(package.id, 1, None)
    db.set_session_status(scored.id, "scored")
    failed = db.create_session(package.id, 2, None)
    db.set_session_status(failed.id, "failed")
    client, _ = _client(db=db)

    response = client.get("/api/users/user-1/packages", headers=AUTH)
    (summary,) = response.json()["packages"]
    assert summary["is_trial"] is True
    assert summary["paid_at"] == "2026-08-03T00:00:00+00:00"
    assert summary["expires_at"] == "2026-09-02T00:00:00+00:00"
    # One scored + one failed row: only the scored one consumed a slot.
    assert summary["sessions_used"] == 1


def test_progress_payload_exposes_payment_state():
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    client, _ = _client(db=db)

    body = client.get(f"/api/packages/{package.id}/progress",
                      headers=AUTH).json()
    assert body["is_trial"] is True
    assert body["paid_at"] is None
    assert body["expires_at"] is None


def test_package_by_token_carries_the_new_columns():
    db = FakeDatabase()
    package = ready_package(db, is_trial=True,
                            paid_at="2026-08-03T00:00:00+00:00",
                            expires_at="2026-09-02T00:00:00+00:00")
    client, _ = _client(db=db)

    body = client.get(f"/api/packages/by-token/{package.access_token}",
                      headers=AUTH).json()
    assert body["is_trial"] is True
    assert body["paid_at"] == "2026-08-03T00:00:00+00:00"
    assert body["expires_at"] == "2026-09-02T00:00:00+00:00"
