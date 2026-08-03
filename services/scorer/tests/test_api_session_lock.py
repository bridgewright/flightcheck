"""F-38 server half: one live session per package at a time.

The audited failure is the tab race. Two tabs on the same package both get
a session, both record, and both upload to a recording key derived from the
session index -- so one overwrites the other, and whichever /complete lands
first scores whichever audio survived. The customer paid for six sessions
and gets a report on a recording that may not be the interview they just
sat.

The lock is derived from state that already exists -- session status plus
updated_at -- and reuses the reaper's staleness notion so a row nobody is
actually in cannot hold the package hostage. The window is the session's
own hard cut: an interview cannot outlive it, so neither can the lock.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from factories import make_rubric
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.routers.sessions import live_session
from scorer.config import load_product_config

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
HARD_CUT_MINUTES = load_product_config().session.hard_cut_minutes


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


@pytest.fixture
def db() -> FakeDatabase:
    return FakeDatabase()


@pytest.fixture
def client(db) -> TestClient:
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([])))


def _paid_package(db: FakeDatabase):
    package = db.create_package("jd", None, user_id="user-1")
    db.set_package_rubric(package.id, make_rubric(), "ready")
    db.set_package_paid(package.id, "order-1", datetime.now(UTC).isoformat())
    return db.get_package(package.id)


def _rows_of(db: FakeDatabase, package_id: str):
    return db.list_sessions(package_id)


# ----------------------------------------------------- the pure predicate


def _row(db, package_id, *, status="planned", mints=0, age_minutes=0.0):
    row = db.create_session(package_id, len(db.sessions), None)
    stamp = (datetime.now(UTC) - timedelta(minutes=age_minutes)).isoformat()
    db.sessions[row.id] = row.model_copy(update={
        "status": status, "secret_mints": mints, "updated_at": stamp,
    })
    return db.sessions[row.id]


class TestTheLivePredicate:
    def test_a_planned_row_nobody_entered_is_not_live(self, db):
        package = _paid_package(db)
        rows = [_row(db, package.id, mints=0, age_minutes=1)]
        assert live_session(rows, HARD_CUT_MINUTES) is None, (
            "starting and abandoning a session before connecting must not "
            "lock the package"
        )

    def test_a_planned_row_someone_connected_to_is_live(self, db):
        package = _paid_package(db)
        rows = [_row(db, package.id, mints=1, age_minutes=1)]
        assert live_session(rows, HARD_CUT_MINUTES) is not None

    def test_a_row_older_than_the_hard_cut_is_not_live(self, db):
        package = _paid_package(db)
        rows = [_row(db, package.id, mints=1, age_minutes=HARD_CUT_MINUTES + 1)]
        assert live_session(rows, HARD_CUT_MINUTES) is None, (
            "a crashed browser must not lock the customer out indefinitely"
        )

    def test_a_row_with_no_clock_is_not_live(self, db):
        package = _paid_package(db)
        row = _row(db, package.id, mints=1)
        db.sessions[row.id] = row.model_copy(update={"updated_at": None})
        assert live_session([db.sessions[row.id]], HARD_CUT_MINUTES) is None, (
            "pre-lifecycle rows have no clock; the reaper ignores them too"
        )

    @pytest.mark.parametrize("status",
                             ["scoring", "scored", "failed", "insufficient"])
    def test_only_a_planned_row_can_be_live(self, db, status):
        package = _paid_package(db)
        rows = [_row(db, package.id, status=status, mints=2, age_minutes=1)]
        assert live_session(rows, HARD_CUT_MINUTES) is None, (
            "scoring runs on the server; it must not block the next session"
        )


# --------------------------------------------------------- the route


class TestTheLockAtSessionCreate:
    def test_a_second_tab_is_refused_while_the_first_is_live(self, client, db):
        package = _paid_package(db)
        first = client.post("/api/sessions", headers=AUTH,
                            json={"package_id": package.id}).json()
        client.post(f"/api/sessions/{first['session_id']}/secret-mint",
                    headers=AUTH)

        response = client.post("/api/sessions", headers=AUTH,
                               json={"package_id": package.id})

        assert response.status_code == 409
        body = response.json()
        assert body["code"] == "session-in-progress"
        assert body["session_id"] == first["session_id"]
        assert "in progress" in body["error"]

    def test_the_refusal_creates_no_second_row(self, client, db):
        package = _paid_package(db)
        first = client.post("/api/sessions", headers=AUTH,
                            json={"package_id": package.id}).json()
        client.post(f"/api/sessions/{first['session_id']}/secret-mint",
                    headers=AUTH)

        client.post("/api/sessions", headers=AUTH, json={"package_id": package.id})

        assert len(_rows_of(db, package.id)) == 1, (
            "a second row would spend a paid slot on the same interview"
        )

    def test_starting_a_session_nobody_entered_is_still_idempotent(self, client, db):
        """The pre-existing resume behaviour must not regress."""
        package = _paid_package(db)
        first = client.post("/api/sessions", headers=AUTH,
                            json={"package_id": package.id}).json()

        second = client.post("/api/sessions", headers=AUTH,
                             json={"package_id": package.id})

        assert second.status_code == 200
        assert second.json()["session_id"] == first["session_id"]

    def test_the_lock_releases_once_the_session_goes_stale(self, client, db):
        package = _paid_package(db)
        first = client.post("/api/sessions", headers=AUTH,
                            json={"package_id": package.id}).json()
        client.post(f"/api/sessions/{first['session_id']}/secret-mint",
                    headers=AUTH)
        stale = (datetime.now(UTC)
                 - timedelta(minutes=HARD_CUT_MINUTES + 1)).isoformat()
        row = db.sessions[first["session_id"]]
        db.sessions[row.id] = row.model_copy(update={"updated_at": stale})

        response = client.post("/api/sessions", headers=AUTH,
                               json={"package_id": package.id})

        assert response.status_code == 200
        assert response.json()["session_id"] == first["session_id"]

    def test_the_next_session_starts_once_the_first_is_scored(self, client, db):
        package = _paid_package(db)
        first = client.post("/api/sessions", headers=AUTH,
                            json={"package_id": package.id}).json()
        client.post(f"/api/sessions/{first['session_id']}/secret-mint",
                    headers=AUTH)
        db.set_session_status(first["session_id"], "scored")

        response = client.post("/api/sessions", headers=AUTH,
                               json={"package_id": package.id})

        assert response.status_code == 200
        assert response.json()["session_id"] != first["session_id"]

    def test_scoring_does_not_block_the_next_session(self, client, db):
        package = _paid_package(db)
        first = client.post("/api/sessions", headers=AUTH,
                            json={"package_id": package.id}).json()
        client.post(f"/api/sessions/{first['session_id']}/secret-mint",
                    headers=AUTH)
        db.set_session_status(first["session_id"], "scoring")
        db.touch_updated_at("session", first["session_id"])

        response = client.post("/api/sessions", headers=AUTH,
                               json={"package_id": package.id})

        assert response.status_code == 200, (
            "scoring runs on the worker for minutes; making the customer "
            "wait for it would be a worse product, not a safer one"
        )


class TestMintKeepsTheClockHonest:
    def test_minting_a_secret_refreshes_the_session_clock(self, client, db):
        package = _paid_package(db)
        created = client.post("/api/sessions", headers=AUTH,
                              json={"package_id": package.id}).json()
        row = db.sessions[created["session_id"]]
        old = (datetime.now(UTC) - timedelta(minutes=99)).isoformat()
        db.sessions[row.id] = row.model_copy(update={"updated_at": old})

        client.post(f"/api/sessions/{row.id}/secret-mint", headers=AUTH)

        refreshed = db.get_session(row.id).updated_at
        assert refreshed is not None and refreshed > old, (
            "the lock window has to track the last room connection, not the "
            "moment the row was created"
        )
