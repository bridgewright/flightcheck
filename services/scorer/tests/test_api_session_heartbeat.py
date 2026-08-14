"""F-47 heartbeat and owner-only stale-session reclaim contracts."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from factories import make_rubric
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.quota import sessions_used
from scorer.api.routers.sessions import live_session
from scorer.config import load_product_config
from scorer.sessionplan.planner import plan_baseline_session

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
SESSION = load_product_config().session


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


def _live_row(db: FakeDatabase):
    package = db.create_package("jd", None, user_id="owner-1")
    db.set_package_rubric(package.id, make_rubric(), "ready")
    db.set_package_paid(package.id, "order-1", datetime.now(UTC).isoformat())
    row = db.create_session(package.id, 1, plan_baseline_session(make_rubric()))
    db.sessions[row.id] = row.model_copy(update={
        "secret_mints": 1,
        "updated_at": datetime.now(UTC).isoformat(),
    })
    return db.get_package(package.id), db.get_session(row.id)


def _heartbeat(db: FakeDatabase, row, age_s: float | None):
    stamp = None if age_s is None else (
        datetime.now(UTC) - timedelta(seconds=age_s)
    ).isoformat()
    db.sessions[row.id] = row.model_copy(update={"last_heartbeat_at": stamp})
    return db.get_session(row.id)


class TestHeartbeatAwareLock:
    def test_an_old_heartbeat_is_reclaimable(self, db):
        _, row = _live_row(db)
        row = _heartbeat(db, row, SESSION.heartbeat_stale_after_s + 1)
        assert live_session(
            [row], SESSION.hard_cut_minutes, SESSION.heartbeat_stale_after_s
        ) is None

    def test_a_fresh_heartbeat_is_still_live(self, db):
        _, row = _live_row(db)
        row = _heartbeat(db, row, SESSION.heartbeat_stale_after_s - 1)
        assert live_session(
            [row], SESSION.hard_cut_minutes, SESSION.heartbeat_stale_after_s
        ) == row

    def test_session_summary_exposes_only_the_derived_stopped_state(self, client, db):
        package, row = _live_row(db)
        _heartbeat(db, row, SESSION.heartbeat_stale_after_s + 1)

        summary = client.get(
            f"/api/packages/{package.id}/sessions", headers=AUTH
        ).json()["sessions"][0]

        assert summary["stopped_reporting"] is True
        assert "last_heartbeat_at" not in summary

    def test_a_null_heartbeat_keeps_the_previous_hard_cut_behavior(self, db):
        _, row = _live_row(db)
        row = _heartbeat(db, row, None)
        assert live_session(
            [row], SESSION.hard_cut_minutes, SESSION.heartbeat_stale_after_s
        ) == row


class TestHeartbeatRoute:
    def test_a_beat_only_stamps_the_heartbeat_clock(self, client, db):
        _, row = _live_row(db)
        before = row.updated_at

        response = client.post(f"/api/sessions/{row.id}/heartbeat", headers=AUTH)

        assert response.status_code == 200
        stored = db.get_session(row.id)
        assert stored.last_heartbeat_at is not None
        assert stored.updated_at == before

    def test_a_non_running_session_refuses_a_beat(self, client, db):
        _, row = _live_row(db)
        db.set_session_status(row.id, "scoring")
        response = client.post(f"/api/sessions/{row.id}/heartbeat", headers=AUTH)
        assert response.status_code == 409


class TestHeartbeatDiagnostics:
    """DECISIONS 072: the trail rides the heartbeat as appended deltas."""

    def test_a_beat_with_diagnostics_appends_the_delta(self, client, db):
        _, row = _live_row(db)

        first = client.post(
            f"/api/sessions/{row.id}/heartbeat", headers=AUTH,
            json={"diagnostics": "100ms greeting-sent"},
        )
        second = client.post(
            f"/api/sessions/{row.id}/heartbeat", headers=AUTH,
            json={"diagnostics": "16040ms speech-started\n17110ms speech-stopped"},
        )

        assert first.status_code == second.status_code == 200
        assert db.session_diagnostics[row.id] == (
            "100ms greeting-sent\n16040ms speech-started\n17110ms speech-stopped"
        )

    def test_a_bodyless_beat_keeps_todays_contract(self, client, db):
        _, row = _live_row(db)

        response = client.post(f"/api/sessions/{row.id}/heartbeat", headers=AUTH)

        assert response.status_code == 200
        assert db.get_session(row.id).last_heartbeat_at is not None
        assert row.id not in db.session_diagnostics

    def test_an_empty_diagnostics_field_appends_nothing(self, client, db):
        _, row = _live_row(db)
        response = client.post(
            f"/api/sessions/{row.id}/heartbeat", headers=AUTH,
            json={"diagnostics": ""},
        )
        assert response.status_code == 200
        assert row.id not in db.session_diagnostics

    def test_a_refused_beat_appends_nothing(self, client, db):
        _, row = _live_row(db)
        db.set_session_status(row.id, "scoring")

        response = client.post(
            f"/api/sessions/{row.id}/heartbeat", headers=AUTH,
            json={"diagnostics": "1ms too-late"},
        )

        assert response.status_code == 409
        assert row.id not in db.session_diagnostics


class TestDiagnosticsCap:
    """The server, not the client, bounds the stored trail."""

    def test_within_the_cap_everything_is_kept(self):
        from scorer.api.db import capped_diagnostics

        joined = capped_diagnostics("1ms a", "2ms b", cap_bytes=64)
        assert joined == "1ms a\n2ms b"

    def test_over_the_cap_the_newest_tail_survives_on_a_line_boundary(self):
        from scorer.api.db import capped_diagnostics

        current = "\n".join(f"{i}ms filler-entry" for i in range(100))
        joined = capped_diagnostics(current, "999999ms newest", cap_bytes=120)

        assert joined.endswith("999999ms newest")
        assert len(joined.encode()) <= 120
        # No partial first line: every retained line still parses.
        assert all(line.split("ms ")[0].isdigit() for line in joined.splitlines())

    def test_a_single_oversized_line_is_kept_truncated(self):
        from scorer.api.db import capped_diagnostics

        joined = capped_diagnostics(None, "1ms " + "x" * 500, cap_bytes=64)
        assert len(joined.encode()) <= 64
        assert joined.endswith("x")


class TestReclaimRoute:
    def test_owner_reclaims_stale_session_without_spending_a_slot(self, client, db):
        package, row = _live_row(db)
        _heartbeat(db, row, SESSION.heartbeat_stale_after_s + 1)

        response = client.post(
            f"/api/sessions/{row.id}/reclaim",
            headers=AUTH,
            json={"user_id": package.user_id, "package_id": package.id},
        )

        assert response.status_code == 200
        stored = db.get_session(row.id)
        assert stored.status == "abandoned"
        assert sessions_used(db.list_sessions(package.id)) == 0

    def test_fresh_session_cannot_be_reclaimed(self, client, db):
        package, row = _live_row(db)
        _heartbeat(db, row, 1)
        response = client.post(
            f"/api/sessions/{row.id}/reclaim",
            headers=AUTH,
            json={"user_id": package.user_id, "package_id": package.id},
        )
        assert response.status_code == 409
        assert db.get_session(row.id).status == "planned"

    def test_other_user_cannot_reclaim(self, client, db):
        package, row = _live_row(db)
        _heartbeat(db, row, SESSION.heartbeat_stale_after_s + 1)
        response = client.post(
            f"/api/sessions/{row.id}/reclaim",
            headers=AUTH,
            json={"user_id": "other", "package_id": package.id},
        )
        assert response.status_code == 404
        assert db.get_session(row.id).status == "planned"

    def test_reclaim_is_idempotent(self, client, db):
        package, row = _live_row(db)
        _heartbeat(db, row, SESSION.heartbeat_stale_after_s + 1)
        payload = {"user_id": package.user_id, "package_id": package.id}
        first = client.post(
            f"/api/sessions/{row.id}/reclaim", headers=AUTH, json=payload
        )
        second = client.post(
            f"/api/sessions/{row.id}/reclaim", headers=AUTH, json=payload
        )
        assert first.status_code == second.status_code == 200
        assert len(db.list_sessions(package.id)) == 1

    def test_start_after_reclaim_reuses_the_free_slot(self, client, db):
        package, row = _live_row(db)
        _heartbeat(db, row, SESSION.heartbeat_stale_after_s + 1)
        payload = {"user_id": package.user_id, "package_id": package.id}
        client.post(f"/api/sessions/{row.id}/reclaim", headers=AUTH, json=payload)

        restarted = client.post(
            "/api/sessions", headers=AUTH, json={"package_id": package.id}
        )

        assert restarted.status_code == 200
        assert restarted.json()["session_id"] == row.id
        assert db.get_session(row.id).status == "planned"
        assert sessions_used(db.list_sessions(package.id)) == 0
