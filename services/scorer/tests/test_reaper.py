"""Tests for the stuck-state reaper (F-31 minimum) and lifecycle touches.

A container death mid-job used to leave "compiling"/"scoring" rows stuck
forever. The reaper flips rows whose updated_at is older than the config
threshold to "failed" (retryable), runs once at startup and then
periodically, and must never touch a row with a fresh clock.
"""
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.reaper import reap_stuck, reap_stuck_safely

NOW = "2026-08-03T12:00:00+00:00"
STALE = "2026-08-03T11:20:00+00:00"      # 40 min old (threshold 30 min)
FRESH = "2026-08-03T11:45:00+00:00"      # 15 min old
AT_CUTOFF = "2026-08-03T11:30:00+00:00"  # exactly at the threshold

THRESHOLD_S = 1800.0


def _stamped_package(db: FakeDatabase, status: str, updated_at: str | None):
    row = db.create_package("jd", None, user_id="user-1")
    db.packages[row.id] = row.model_copy(
        update={"status": status, "updated_at": updated_at})
    return db.get_package(row.id)


def _stamped_session(db: FakeDatabase, status: str, updated_at: str | None):
    package = db.create_package("jd", None, user_id="user-1")
    row = db.create_session(package.id, 1, None)
    db.sessions[row.id] = row.model_copy(
        update={"status": status, "updated_at": updated_at})
    return db.get_session(row.id)


def test_reap_flips_stale_compiling_and_scoring_rows_to_failed():
    db = FakeDatabase()
    db.now_iso = NOW
    stuck_package = _stamped_package(db, "compiling", STALE)
    stuck_session = _stamped_session(db, "scoring", STALE)

    reaped = reap_stuck(db, stale_after_s=THRESHOLD_S)

    assert reaped == {"packages": [stuck_package.id],
                      "sessions": [stuck_session.id]}
    assert db.get_package(stuck_package.id).status == "failed"
    assert db.get_session(stuck_session.id).status == "failed"
    # The terminal write refreshes the clock so the row is never re-reaped.
    assert db.get_package(stuck_package.id).updated_at == NOW
    assert db.get_session(stuck_session.id).updated_at == NOW


def test_reap_never_touches_fresh_or_boundary_rows():
    # The boundary matters: a row updated EXACTLY threshold seconds ago is
    # not yet stale (strict <), and a fresh row must never be reaped -- a
    # live 20-minute scoring run looks exactly like this.
    db = FakeDatabase()
    db.now_iso = NOW
    fresh_package = _stamped_package(db, "compiling", FRESH)
    boundary_package = _stamped_package(db, "compiling", AT_CUTOFF)
    fresh_session = _stamped_session(db, "scoring", FRESH)

    reaped = reap_stuck(db, stale_after_s=THRESHOLD_S)

    assert reaped == {"packages": [], "sessions": []}
    assert db.get_package(fresh_package.id).status == "compiling"
    assert db.get_package(boundary_package.id).status == "compiling"
    assert db.get_session(fresh_session.id).status == "scoring"


def test_reap_ignores_null_clocks_and_other_statuses():
    db = FakeDatabase()
    db.now_iso = NOW
    null_clock = _stamped_package(db, "compiling", None)   # pre-batch row
    ready_row = _stamped_package(db, "ready", STALE)
    scored_session = _stamped_session(db, "scored", STALE)

    reaped = reap_stuck(db, stale_after_s=THRESHOLD_S)

    assert reaped == {"packages": [], "sessions": []}
    assert db.get_package(null_clock.id).status == "compiling"
    assert db.get_package(ready_row.id).status == "ready"
    assert db.get_session(scored_session.id).status == "scored"


def test_reap_safely_swallows_database_failures():
    class BrokenDatabase(FakeDatabase):
        def list_stale_packages(self, status, older_than_s):
            raise RuntimeError("database outage")

    assert reap_stuck_safely(BrokenDatabase(), stale_after_s=THRESHOLD_S) is None


def test_startup_reaps_rows_orphaned_by_a_dead_container(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    db.now_iso = NOW
    stuck = _stamped_package(db, "compiling", STALE)
    app = create_app(db, FakeStorage(), FakeGenAI([]))

    # Lifespan runs on context entry -- the startup pass, then the periodic
    # task (which only sleeps at the default cadence during this test).
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        assert db.get_package(stuck.id).status == "failed"


def test_lifecycle_status_writes_touch_the_session_clock(monkeypatch):
    # The scoring pipeline stamps updated_at alongside every status/stage
    # write, so an in-flight run always looks fresh to the reaper.
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    db.now_iso = NOW
    package = ready_package(db)
    client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))
    auth = {"Authorization": "Bearer test-worker-token"}
    session_id = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=auth
    ).json()["session_id"]
    db.sessions[session_id] = db.get_session(session_id).model_copy(
        update={"updated_at": None})

    # The job fails on a missing recording; the failure write must stamp
    # the clock all the same.
    client.post(f"/api/sessions/{session_id}/complete",
                json={"audio_path": "packages/missing.wav"}, headers=auth)

    row = db.get_session(session_id)
    assert row.status == "failed"
    assert row.updated_at == NOW
