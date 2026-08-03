"""Tests for tools/purge_user.py -- the operator-only account purge.

House pattern (test_backfill_transcripts.py): only the offline pieces are
tested. Plan collection and email matching run against the shared fakes;
execute_purge runs against an in-file fake Supabase client that records
every delete; the argparse rules pin the dry-run default and the refusal to
run without an explicit identifier. The Supabase/auth-admin wiring in
main() is thin and exercised manually (operator-run, never part of the app).
"""
from types import SimpleNamespace

import pytest
from purge_user import (
    build_parser,
    collect_purge_plan,
    describe_plan,
    execute_purge,
    match_user_id,
)

from fakes import FakeDatabase
from scorer.api.db import OrderRow
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
    """One package for user_id with the requested sessions and one order."""
    package = db.create_package("JD text", None, user_id=user_id)
    session_ids, audio_paths = [], []
    index = 0
    for _ in range(sessions_with_audio):
        index += 1
        session = db.create_session(package.id, index, _plan())
        path = f"packages/{package.id}/{session.id}.webm"
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


# --- collect_purge_plan (against the fakes) -----------------------------------


def test_plan_collects_only_the_target_users_rows_and_recordings():
    db = FakeDatabase()
    target = _seed_user(db, "user-a", sessions_with_audio=2)
    _seed_user(db, "user-b")           # other account: must survive untouched
    db.create_package("JD text", None)  # unclaimed package: no owner to match

    plan = collect_purge_plan(db, "user-a")

    assert plan.user_id == "user-a"
    assert plan.package_ids == [target["package_id"]]
    assert sorted(plan.session_ids) == sorted(target["session_ids"])
    assert plan.order_ids == [target["order_id"]]
    assert sorted(plan.recording_paths) == sorted(target["audio_paths"])


def test_plan_keeps_audioless_sessions_in_rows_but_not_in_recordings():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=1,
                        sessions_without_audio=1)

    plan = collect_purge_plan(db, "user-a")

    assert sorted(plan.session_ids) == sorted(seeded["session_ids"])
    assert plan.recording_paths == seeded["audio_paths"]


def test_plan_for_an_unknown_user_is_empty():
    db = FakeDatabase()
    _seed_user(db, "user-a")

    plan = collect_purge_plan(db, "user-nobody")

    assert plan.is_empty
    assert plan.package_ids == []
    assert plan.session_ids == []
    assert plan.order_ids == []
    assert plan.recording_paths == []


# --- match_user_id (pure) -----------------------------------------------------


def _user(user_id: str, email: str | None) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, email=email)


def test_match_user_id_matches_case_insensitively():
    users = [_user("u-1", "Someone@Example.com"), _user("u-2", "other@example.com")]
    assert match_user_id(users, "someone@example.COM") == "u-1"


def test_match_user_id_refuses_an_unknown_email():
    with pytest.raises(LookupError):
        match_user_id([_user("u-1", "a@example.com"), _user("u-2", None)],
                      "missing@example.com")


def test_match_user_id_refuses_an_ambiguous_email():
    users = [_user("u-1", "dup@example.com"), _user("u-2", "dup@example.com")]
    with pytest.raises(LookupError, match="matches 2"):
        match_user_id(users, "dup@example.com")


# --- execute_purge (against a recording fake client) --------------------------


class _FakeDelete:
    def __init__(self, log: list, table: str):
        self._log, self._table = log, table

    def delete(self) -> "_FakeDelete":
        return self

    def in_(self, column: str, ids: list[str]) -> "_FakeDelete":
        self._log.append(("delete", self._table, column, list(ids)))
        return self

    def execute(self) -> None:
        return None


class _FakeBucket:
    def __init__(self, log: list, name: str):
        self._log, self._name = log, name

    def remove(self, paths: list[str]) -> None:
        self._log.append(("remove", self._name, list(paths)))


class _FakeStorageApi:
    def __init__(self, log: list):
        self._log = log

    def from_(self, name: str) -> _FakeBucket:
        return _FakeBucket(self._log, name)


class FakeSupabaseClient:
    """Records every destructive call as (op, target, ...) in order."""

    def __init__(self):
        self.log: list[tuple] = []
        self.storage = _FakeStorageApi(self.log)

    def table(self, name: str) -> _FakeDelete:
        return _FakeDelete(self.log, name)


def test_execute_purge_removes_recordings_first_then_rows_child_first():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=2)
    plan = collect_purge_plan(db, "user-a")
    client = FakeSupabaseClient()

    execute_purge(client, plan)

    # Recordings before rows: the rows are the only index to the bucket
    # paths, so a failed object removal must leave them findable for a rerun.
    # Then child-first (orders, sessions) before packages.
    assert [entry[0:2] for entry in client.log] == [
        ("remove", "recordings"),
        ("delete", "orders"),
        ("delete", "sessions"),
        ("delete", "packages"),
    ]
    by_table = {entry[1]: entry for entry in client.log if entry[0] == "delete"}
    assert by_table["orders"][3] == [seeded["order_id"]]
    assert sorted(by_table["sessions"][3]) == sorted(seeded["session_ids"])
    assert by_table["packages"][3] == [seeded["package_id"]]
    assert by_table["orders"][2] == "id"
    assert client.log[0][2] == plan.recording_paths


def test_execute_purge_on_an_empty_plan_touches_nothing():
    plan = collect_purge_plan(FakeDatabase(), "user-nobody")
    client = FakeSupabaseClient()

    execute_purge(client, plan)

    assert client.log == []


def test_execute_purge_skips_the_bucket_when_no_recordings_exist():
    db = FakeDatabase()
    _seed_user(db, "user-a", sessions_with_audio=0, sessions_without_audio=1)
    plan = collect_purge_plan(db, "user-a")
    client = FakeSupabaseClient()

    execute_purge(client, plan)

    assert [entry[0] for entry in client.log] == ["delete", "delete", "delete"]


# --- the CLI contract ---------------------------------------------------------


def test_parser_refuses_to_run_without_an_identifier(capsys):
    with pytest.raises(SystemExit):
        build_parser().parse_args([])
    assert "required" in capsys.readouterr().err


def test_parser_refuses_both_identifiers_at_once(capsys):
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            ["--user-id", "u-1", "--email", "a@example.com"])
    assert "not allowed" in capsys.readouterr().err


def test_parser_defaults_to_dry_run():
    args = build_parser().parse_args(["--user-id", "u-1"])
    assert args.execute is False


# --- the dry-run report -------------------------------------------------------


def test_describe_plan_lists_everything_that_would_be_deleted():
    db = FakeDatabase()
    seeded = _seed_user(db, "user-a", sessions_with_audio=1)
    plan = collect_purge_plan(db, "user-a")

    text = describe_plan(plan)

    assert seeded["package_id"] in text
    assert seeded["session_ids"][0] in text
    assert seeded["order_id"] in text
    assert seeded["audio_paths"][0] in text


def test_describe_plan_says_so_when_there_is_nothing_to_delete():
    plan = collect_purge_plan(FakeDatabase(), "user-nobody")
    assert "Nothing" in describe_plan(plan)
