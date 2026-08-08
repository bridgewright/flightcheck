"""Account deletion: the one implementation the endpoint and the CLI share.

api/deletion.py is promoted out of tools/purge_user.py so DELETE /api/account
and `uv run python tools/purge_user.py` cannot drift apart. These tests own
the two things that make deletion safe rather than merely destructive:

- the PLAN is collected before anything is touched, and only the target
  user's rows appear in it;
- the ORDER is blobs first, rows second, and a blob that will not delete
  aborts the whole thing BEFORE a single row is removed. The session rows
  are the only index to the bucket keys, so removing rows first would strand
  recordings that nobody can ever find again -- a privacy promise broken
  silently, which is the worst failure mode this feature has.

Everything runs against the shared fakes (house pattern), including the
storage failure, which FakeStorage can inject.
"""
from __future__ import annotations

import pytest

from fakes import FakeDatabase, FakeStorage
from scorer.api.db import OrderRow
from scorer.api.deletion import (
    DeletionPlan,
    RecordingsNotDeleted,
    collect_deletion_plan,
    describe_plan,
    execute_deletion,
    recording_key,
)
from scorer.schemas import QuestionSpec, SessionPlan


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


def _seed_user(db: FakeDatabase, user_id: str, *, sessions_with_audio: int = 1,
               sessions_without_audio: int = 0) -> dict:
    """One package for user_id with the requested sessions and one order.

    Audio paths are the real contract key (recording_key), because that is
    what production writes: the web mints the signed upload URL for that key
    and /complete copies it onto the row. A fixture that invented a
    different shape would make the derived-key sweep look like it always
    finds something new, which is the opposite of the truth.
    """
    package = db.create_package("JD text", None, user_id=user_id)
    session_ids, audio_paths = [], []
    index = 0
    for _ in range(sessions_with_audio):
        index += 1
        session = db.create_session(package.id, index, _plan())
        path = recording_key(package.id, index)
        db.set_session_status(session.id, "scored", audio_path=path)
        session_ids.append(session.id)
        audio_paths.append(path)
    for _ in range(sessions_without_audio):
        index += 1
        session = db.create_session(package.id, index, _plan())
        session_ids.append(session.id)
    order = db.insert_order(OrderRow(
        user_id=user_id,
        package_id=package.id,
        polar_order_id=f"polar-{package.id}",
    ))
    return {"package_id": package.id, "session_ids": session_ids,
            "audio_paths": audio_paths, "order_id": order.id}


def _storage_for(db: FakeDatabase) -> FakeStorage:
    """FakeStorage holding every recording the seeded sessions point at."""
    return FakeStorage(recordings={
        row.audio_path: b"audio"
        for row in db.sessions.values() if row.audio_path
    })


# --- the plan ----------------------------------------------------------------


def test_plan_collects_only_the_target_users_rows_and_recordings():
    db = FakeDatabase()
    target = _seed_user(db, "user-a", sessions_with_audio=2)
    _seed_user(db, "user-b")            # other account: must survive untouched
    db.create_package("JD text", None)  # unclaimed package: no owner to match

    plan = collect_deletion_plan(db, "user-a")

    assert plan.user_id == "user-a"
    assert plan.package_ids == [target["package_id"]]
    assert sorted(plan.session_ids) == sorted(target["session_ids"])
    assert plan.order_ids == [target["order_id"]]
    assert sorted(plan.recording_paths) == sorted(target["audio_paths"])


def test_plan_keeps_audioless_sessions_in_rows_but_not_in_recordings():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=1,
                        sessions_without_audio=1)

    plan = collect_deletion_plan(db, "user-a")

    assert sorted(plan.session_ids) == sorted(seeded["session_ids"])
    assert plan.recording_paths == seeded["audio_paths"]


# --- recordings the rows do not name -----------------------------------------


def test_a_session_with_no_audio_path_still_gets_its_key_swept():
    # The row is written by /complete, which runs AFTER the browser has
    # already PUT the blob. An audio_path-less session is exactly the shape
    # of "the upload landed and the complete call did not", so its contract
    # key has to be swept or that recording survives the deletion forever.
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=0,
                        sessions_without_audio=1)

    plan = collect_deletion_plan(db, "user-a")

    assert plan.recording_paths == []
    assert plan.orphan_recording_paths == [
        recording_key(seeded["package_id"], 1)]


def test_a_key_the_rows_already_name_is_not_swept_twice():
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=2)

    plan = collect_deletion_plan(db, "user-a")

    assert plan.orphan_recording_paths == []
    assert len(plan.storage_keys) == len(set(plan.storage_keys)) == 2


def test_an_upload_whose_complete_call_never_landed_is_deleted():
    # The end-to-end version of the gap: a real blob in the bucket that no
    # row points at. /settings promises "every recording, deleted from
    # private storage", so this must not survive.
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=1,
                        sessions_without_audio=1)
    stranded = recording_key(seeded["package_id"], 2)
    storage = FakeStorage(recordings={seeded["audio_paths"][0]: b"audio",
                                      stranded: b"audio"})

    execute_deletion(db, storage, collect_deletion_plan(db, "user-a"))

    assert storage.recordings == {}
    assert stranded in storage.removed


def test_the_reported_recording_count_stays_the_one_we_measured():
    # Swept keys are not counted: the storage protocol cannot tell "removed"
    # from "was never there", so counting them would show the customer a
    # number nobody measured.
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=1, sessions_without_audio=3)
    storage = _storage_for(db)

    outcome = execute_deletion(db, storage, collect_deletion_plan(db, "user-a"))

    assert outcome.recordings_deleted == 1


def test_the_sweep_never_reaches_another_accounts_package():
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=0, sessions_without_audio=1)
    survivor = _seed_user(db, "user-b", sessions_with_audio=1)

    plan = collect_deletion_plan(db, "user-a")

    assert all(survivor["package_id"] not in key for key in plan.storage_keys)


def test_plan_for_an_unknown_user_is_empty():
    db = FakeDatabase()
    _seed_user(db, "user-a")

    plan = collect_deletion_plan(db, "user-nobody")

    assert plan.is_empty
    assert (plan.package_ids, plan.session_ids, plan.order_ids,
            plan.recording_paths) == ([], [], [], [])


def test_collecting_the_plan_deletes_nothing_by_itself():
    # The read half must be safe to run at any time -- it is what --dry-run
    # prints and what the endpoint calls before deciding anything.
    db = FakeDatabase()
    _seed_user(db, "user-a")
    before = (dict(db.packages), dict(db.sessions), dict(db.orders))

    collect_deletion_plan(db, "user-a")

    assert (db.packages, db.sessions, db.orders) == before


# --- execution: ordering and totals ------------------------------------------


def test_execute_removes_recordings_first_then_rows_child_first():
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=2)
    storage = _storage_for(db)
    plan = collect_deletion_plan(db, "user-a")

    execute_deletion(db, storage, plan)

    assert storage.removed == plan.recording_paths
    # Child-first: orders and sessions before the packages they hang off.
    assert [kind for kind, _ in db.deletes] == [
        "order", "session", "study", "package",
    ]


def test_execute_removes_every_artifact_of_the_user():
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=2, sessions_without_audio=1)
    storage = _storage_for(db)
    plan = collect_deletion_plan(db, "user-a")

    outcome = execute_deletion(db, storage, plan)

    assert (db.packages, db.sessions, db.orders, db.transcripts) == ({}, {}, {}, {})
    assert storage.recordings == {}
    assert outcome.packages_deleted == 1
    assert outcome.sessions_deleted == 3
    assert outcome.orders_deleted == 1
    assert outcome.recordings_deleted == 2


def test_execute_leaves_every_other_account_untouched():
    db = FakeDatabase()
    _seed_user(db, "user-a")
    survivor = _seed_user(db, "user-b", sessions_with_audio=1)
    storage = _storage_for(db)

    execute_deletion(db, storage, collect_deletion_plan(db, "user-a"))

    assert list(db.packages) == [survivor["package_id"]]
    assert list(db.sessions) == survivor["session_ids"]
    assert list(db.orders) == [survivor["order_id"]]
    assert list(storage.recordings) == survivor["audio_paths"]


def test_execute_on_an_empty_plan_touches_nothing():
    db = FakeDatabase()
    storage = FakeStorage()

    outcome = execute_deletion(db, storage, collect_deletion_plan(db, "nobody"))

    assert db.deletes == []
    assert storage.removed == []
    assert outcome.total == 0


def test_execute_skips_the_bucket_when_there_is_no_session_at_all():
    # No sessions means no key to derive, so there is nothing to ask storage
    # about. (A session with no audio_path is a different case -- its blob
    # may be sitting in the bucket unindexed, so its key IS swept.)
    db = FakeDatabase()
    db.create_package("JD text", None, user_id="user-a")
    storage = FakeStorage()

    outcome = execute_deletion(db, storage, collect_deletion_plan(db, "user-a"))

    assert storage.remove_calls == []   # no pointless round trip
    assert outcome.recordings_deleted == 0
    assert db.packages == {}


def test_audioless_sessions_still_cost_exactly_one_storage_call():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=0,
                        sessions_without_audio=2)
    storage = FakeStorage()

    outcome = execute_deletion(db, storage, collect_deletion_plan(db, "user-a"))

    assert storage.remove_calls == [
        [recording_key(seeded["package_id"], 1),
         recording_key(seeded["package_id"], 2)]]
    assert outcome.recordings_deleted == 0
    assert db.sessions == {}


def test_execute_is_idempotent_so_a_retry_converges():
    # The self-serve path has no operator watching it: a second attempt after
    # any failure must succeed rather than error on rows that are already gone.
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=1)
    storage = _storage_for(db)
    plan = collect_deletion_plan(db, "user-a")

    execute_deletion(db, storage, plan)
    again = execute_deletion(db, storage, plan)

    assert (again.packages_deleted, again.sessions_deleted,
            again.orders_deleted) == (0, 0, 0)
    assert (db.packages, db.sessions, db.orders) == ({}, {}, {})


# --- execution: partial storage failure --------------------------------------


def test_a_recording_that_will_not_delete_aborts_before_any_row_is_removed():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=2)
    storage = _storage_for(db)
    storage.remove_failures.add(seeded["audio_paths"][1])
    plan = collect_deletion_plan(db, "user-a")

    with pytest.raises(RecordingsNotDeleted) as excinfo:
        execute_deletion(db, storage, plan)

    # Rows are the ONLY index to the bucket keys. Deleting them here would
    # strand the surviving recording where nobody can find it again.
    assert excinfo.value.paths == [seeded["audio_paths"][1]]
    assert db.deletes == []
    assert list(db.packages) == [seeded["package_id"]]
    assert sorted(db.sessions) == sorted(seeded["session_ids"])
    assert list(db.orders) == [seeded["order_id"]]


def test_the_retry_after_a_storage_failure_completes_the_deletion():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=2)
    storage = _storage_for(db)
    storage.remove_failures.add(seeded["audio_paths"][1])
    plan = collect_deletion_plan(db, "user-a")
    with pytest.raises(RecordingsNotDeleted):
        execute_deletion(db, storage, plan)

    # Storage recovers; the SAME plan (the rows still index it) now completes.
    storage.remove_failures.clear()
    outcome = execute_deletion(db, storage, plan)

    assert storage.recordings == {}
    assert (db.packages, db.sessions, db.orders) == ({}, {}, {})
    # recordings_deleted counts objects CONFIRMED GONE, not objects this call
    # happened to remove -- the storage protocol cannot tell those apart, and
    # claiming otherwise would be a number we did not measure. The object the
    # first attempt removed is still gone, so both count.
    assert outcome.recordings_deleted == 2


def test_the_error_names_only_the_paths_that_failed():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=2)
    storage = _storage_for(db)
    storage.remove_failures.update(seeded["audio_paths"])

    with pytest.raises(RecordingsNotDeleted) as excinfo:
        execute_deletion(db, storage, collect_deletion_plan(db, "user-a"))

    assert sorted(excinfo.value.paths) == sorted(seeded["audio_paths"])
    assert "2 recording" in str(excinfo.value)


# --- the dry-run report -------------------------------------------------------


def test_describe_plan_lists_everything_that_would_be_deleted():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=1)

    text = describe_plan(collect_deletion_plan(db, "user-a"))

    assert seeded["package_id"] in text
    assert seeded["session_ids"][0] in text
    assert seeded["order_id"] in text
    assert seeded["audio_paths"][0] in text


def test_describe_plan_marks_the_swept_keys_as_derived_not_as_findings():
    # The operator must not read "1 derived recording key" as "one orphaned
    # recording exists" -- it is a key we are sweeping blind.
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=0,
                        sessions_without_audio=1)

    text = describe_plan(collect_deletion_plan(db, "user-a"))

    assert "derived recording key(s) also swept (may hold nothing)" in text
    assert recording_key(seeded["package_id"], 1) in text


def test_describe_plan_says_so_when_there_is_nothing_to_delete():
    assert "Nothing" in describe_plan(collect_deletion_plan(FakeDatabase(), "nobody"))


def test_an_empty_plan_is_empty_and_a_populated_one_is_not():
    assert DeletionPlan(user_id="u").is_empty
    assert not DeletionPlan(user_id="u", order_ids=["o-1"]).is_empty
    assert not DeletionPlan(user_id="u", recording_paths=["p"]).is_empty
    assert not DeletionPlan(user_id="u", orphan_recording_paths=["p"]).is_empty
