"""DELETE /api/account -- the HTTP half of F-34 self-serve deletion.

The logic is api/deletion.py's and is tested there; what this file owns is
the HTTP contract the web client depends on and the refusal paths a
customer can actually hit:

- the id arrives as a query parameter (the web sends `?user_id=`), and a
  missing or blank one is a 422, never a delete-everyone;
- a storage failure answers 503 with an honest "nothing was deleted", so
  the web can leave the account and its sign-in record alone;
- nothing about a deleted account -- its id, its recording keys -- is
  echoed back or written to a log line we would then have to keep.

Runs against the real HTTP surface with the fakes behind it (house
pattern): no transport mocking anywhere.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.db import OrderRow
from scorer.api.deletion import recording_key
from scorer.schemas import QuestionSpec, SessionPlan

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _plan() -> SessionPlan:
    question = QuestionSpec(
        dimension_key="structured-answers",
        question="Walk me through a project you led end to end.",
        probes=["What was your specific role?"],
        source="generated",
    )
    return SessionPlan(
        session_index=1,
        focus="baseline",
        question_sequence=[question],
        pressure_probe=question,
        time_budget_minutes=20,
    )


def _seed(db: FakeDatabase, user_id: str, *, sessions: int = 2) -> dict:
    package = db.create_package("JD text", None, user_id=user_id)
    paths = []
    for index in range(1, sessions + 1):
        session = db.create_session(package.id, index, _plan())
        # The real contract key (api/deletion.recording_key), which is what
        # the web mints the upload URL for and what /complete copies onto
        # the row -- not an invented shape.
        path = recording_key(package.id, index)
        db.set_session_status(session.id, "scored", audio_path=path)
        paths.append(path)
    db.insert_order(OrderRow(user_id=user_id, package_id=package.id,
                             polar_order_id=f"polar-{package.id}"))
    return {"package_id": package.id, "audio_paths": paths}


@pytest.fixture
def world():
    db = FakeDatabase()
    seeded = _seed(db, "user-a")
    storage = FakeStorage(recordings={path: b"audio" for path in seeded["audio_paths"]})
    client = TestClient(create_app(db, storage, FakeGenAI([])))
    return {"db": db, "storage": storage, "client": client, "seeded": seeded}


# --- the happy path ----------------------------------------------------------


def test_deleting_an_account_removes_every_artifact_of_it(world):
    response = world["client"].delete("/api/account", params={"user_id": "user-a"},
                                      headers=AUTH)

    assert response.status_code == 200
    db, storage = world["db"], world["storage"]
    assert (db.packages, db.sessions, db.orders) == ({}, {}, {})
    assert storage.recordings == {}


def test_the_response_reports_what_was_deleted(world):
    body = world["client"].delete("/api/account", params={"user_id": "user-a"},
                                  headers=AUTH).json()

    assert body == {"deleted": {"packages": 1, "sessions": 2, "orders": 1,
                                "recordings": 2, "feedback": 0}}


def test_deleting_an_account_that_owns_nothing_succeeds(world):
    # Idempotency at the HTTP level: a retry after a partial failure, or a
    # user who never bought anything, must not get an error to act on.
    body = world["client"].delete("/api/account", params={"user_id": "user-nobody"},
                                  headers=AUTH).json()

    assert body == {"deleted": {"packages": 0, "sessions": 0, "orders": 0,
                                "recordings": 0, "feedback": 0}}
    assert world["db"].packages != {}   # the real account is untouched


def test_a_recording_no_session_row_names_is_deleted_too(world):
    # The upload lands before /complete writes audio_path, so a failed
    # complete leaves a real customer recording in the bucket that no row
    # points at. The endpoint promises "every recording"; this is the one
    # that used to survive it.
    db = world["db"]
    package_id = world["seeded"]["package_id"]
    db.create_session(package_id, 3, _plan())      # no audio_path ever written
    stranded = recording_key(package_id, 3)
    world["storage"].recordings[stranded] = b"audio"

    response = world["client"].delete("/api/account", params={"user_id": "user-a"},
                                      headers=AUTH)

    assert response.status_code == 200
    assert world["storage"].recordings == {}
    # Counted honestly: two keys the rows named, not the swept third.
    assert response.json()["deleted"]["recordings"] == 2


def test_deleting_one_account_leaves_the_others_alone(world):
    other = _seed(world["db"], "user-b", sessions=1)

    world["client"].delete("/api/account", params={"user_id": "user-a"}, headers=AUTH)

    assert list(world["db"].packages) == [other["package_id"]]


# --- refusals ----------------------------------------------------------------


def test_deletion_is_behind_the_bearer_token(world):
    response = world["client"].delete("/api/account", params={"user_id": "user-a"})

    assert response.status_code == 401
    assert world["db"].packages != {}   # nothing ran


def test_a_missing_user_id_is_a_422_not_a_delete_everyone(world):
    assert world["client"].delete("/api/account", headers=AUTH).status_code == 422
    assert world["db"].packages != {}


def test_a_blank_user_id_is_refused(world):
    # `?user_id=` is a client bug, not "the account that owns nothing" --
    # answering 200 to it would hide the bug behind a plausible success.
    response = world["client"].delete("/api/account", params={"user_id": "   "},
                                      headers=AUTH)

    assert response.status_code == 422
    assert world["db"].packages != {}


# --- the storage failure the feature is designed around ----------------------


def test_a_recording_that_will_not_delete_answers_503_and_deletes_nothing(world):
    world["storage"].remove_failures.add(world["seeded"]["audio_paths"][0])

    response = world["client"].delete("/api/account", params={"user_id": "user-a"},
                                      headers=AUTH)

    assert response.status_code == 503
    assert response.json()["code"] == "recordings-not-deleted"
    # The whole point of blobs-first: the account is intact and retryable.
    db = world["db"]
    assert len(db.packages) == 1
    assert len(db.sessions) == 2
    assert len(db.orders) == 1


def test_the_failure_body_names_no_storage_key_and_no_user(world):
    paths = world["seeded"]["audio_paths"]
    world["storage"].remove_failures.update(paths)

    body = world["client"].delete("/api/account", params={"user_id": "user-a"},
                                  headers=AUTH).text

    for path in paths:
        assert path not in body
    assert "user-a" not in body
    assert world["seeded"]["package_id"] not in body


def test_the_failure_message_tells_the_caller_nothing_was_deleted(world):
    world["storage"].remove_failures.update(world["seeded"]["audio_paths"])

    error = world["client"].delete("/api/account", params={"user_id": "user-a"},
                                   headers=AUTH).json()["error"]

    assert "nothing was deleted" in error.lower()


def test_a_retry_after_storage_recovers_completes_the_deletion(world):
    client, storage = world["client"], world["storage"]
    storage.remove_failures.update(world["seeded"]["audio_paths"])
    assert client.delete("/api/account", params={"user_id": "user-a"},
                         headers=AUTH).status_code == 503

    storage.remove_failures.clear()
    response = client.delete("/api/account", params={"user_id": "user-a"},
                             headers=AUTH)

    assert response.status_code == 200
    assert (world["db"].packages, world["db"].sessions) == ({}, {})


# --- what must not end up in the logs ----------------------------------------


def test_the_deleted_users_id_is_never_logged(world, caplog):
    # An account deletion that leaves the account id sitting in a log
    # aggregator has not really deleted much. Counts are what an operator
    # needs; the request id (middleware) is how the line is correlated.
    # Scoped to this router's logger on purpose: the id rides in the query
    # string by the Phase 0 contract, so the ASGI server's access log is a
    # separate, documented concern (docs/ops/backup-restore.md).
    with caplog.at_level("INFO", logger="scorer.api.routers.account"):
        world["client"].delete("/api/account", params={"user_id": "user-a"},
                               headers=AUTH)

    ours = [record for record in caplog.records
            if record.name == "scorer.api.routers.account"]
    assert ours, "the deletion should leave an operator-readable trace"
    assert all("user-a" not in record.getMessage() for record in ours)
