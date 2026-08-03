"""v0.5 payments surface of scorer.api.db: OrderRow, paid/trial/expiry package
fields, secret-mint counting, updated_at touches, stale-row listing, and the
compile-retry reset — tested against FakeDatabase (semantics) and StubSupabase
(query mapping). Track C builds the endpoints on these primitives.
"""
from datetime import UTC, datetime, timedelta

import pytest
from test_api_db import StubSupabase, _package_data, _plan

from fakes import FakeDatabase
from scorer.api.db import (
    EXPIRY_DAYS,
    PAID_TOTAL_SESSIONS,
    SESSION_COLUMNS,
    OrderRow,
    PackageRow,
    SessionRow,
    SupabaseDatabase,
    expires_at_from,
)


def _order(**overrides) -> OrderRow:
    data = {
        "user_id": "user-1",
        "package_id": "pkg-1",
        "polar_order_id": "polar-ord-1",
        "polar_checkout_id": "polar-chk-1",
        "amount_minor": 4900,
        "currency": "usd",
        "status": "paid",
    }
    data.update(overrides)
    return OrderRow.model_validate(data)


# ---------------------------------------------------------------- row models


def test_package_row_defaults_keep_pre_migration_rows_valid():
    # Rows stored before migration 005 carry none of the new columns; the
    # model must validate them via defaults.
    row = PackageRow(
        id="pkg-1", access_token="tok-1", status="ready", jd_text="jd",
        candidate_profile=None, rubric=None,
    )
    assert row.is_trial is False
    assert row.paid_at is None
    assert row.expires_at is None
    assert row.order_id is None
    assert row.updated_at is None


def test_session_row_defaults_keep_pre_migration_rows_valid():
    row = SessionRow(
        id="sess-1", package_id="pkg-1", index=1, status="planned",
        session_plan=None, audio_path=None, report=None,
    )
    assert row.updated_at is None
    assert row.secret_mints == 0


def test_order_row_optional_fields_default_to_none():
    row = OrderRow(user_id="u", package_id="p", polar_order_id="po")
    assert row.id is None
    assert row.polar_checkout_id is None
    assert row.amount_minor is None
    assert row.currency is None
    assert row.status is None
    assert row.created_at is None


def test_session_columns_include_the_new_columns():
    assert "updated_at" in SESSION_COLUMNS.split(",")
    assert "secret_mints" in SESSION_COLUMNS.split(",")


def test_expires_at_is_thirty_days_after_paid_at():
    assert EXPIRY_DAYS == 30
    assert PAID_TOTAL_SESSIONS == 6
    assert (expires_at_from("2026-08-03T12:00:00+00:00")
            == "2026-09-02T12:00:00+00:00")
    # 'Z' suffix (Polar-style timestamps) parses too.
    assert expires_at_from("2026-08-03T12:00:00Z").startswith("2026-09-02T12:00:00")


# ------------------------------------------------------------- fake: orders


def test_fake_insert_order_assigns_id_and_round_trips():
    db = FakeDatabase()
    stored = db.insert_order(_order())
    assert stored.id == "order-1"
    assert stored.created_at is not None
    assert db.find_order_by_polar_id("polar-ord-1") == stored


def test_fake_insert_order_rejects_duplicate_polar_order_id():
    # Mirrors the orders.polar_order_id UNIQUE constraint (webhook
    # idempotency): the real adapter raises postgrest's error, the fake
    # raises ValueError — either way a replayed insert never lands twice.
    db = FakeDatabase()
    db.insert_order(_order())
    with pytest.raises(ValueError):
        db.insert_order(_order())


def test_fake_find_order_by_polar_id_none_when_absent():
    assert FakeDatabase().find_order_by_polar_id("nope") is None


def test_fake_list_orders_for_user_newest_first_and_filters():
    db = FakeDatabase()
    first = db.insert_order(_order(polar_order_id="po-1"))
    second = db.insert_order(_order(polar_order_id="po-2"))
    db.insert_order(_order(polar_order_id="po-3", user_id="someone-else"))
    assert db.list_orders_for_user("user-1") == [second, first]
    assert db.list_orders_for_user("nobody") == []


# --------------------------------------------------------- fake: paid state


def test_fake_set_package_paid_flips_trial_package_to_paid():
    db = FakeDatabase()
    package = db.create_package("jd", None, user_id="user-1")
    db.packages[package.id] = package.model_copy(
        update={"is_trial": True, "total_sessions": 1})
    db.set_package_paid(package.id, "order-1", "2026-08-03T12:00:00+00:00")
    row = db.get_package(package.id)
    assert row.paid_at == "2026-08-03T12:00:00+00:00"
    assert row.expires_at == "2026-09-02T12:00:00+00:00"
    assert row.order_id == "order-1"
    assert row.total_sessions == PAID_TOTAL_SESSIONS
    assert row.updated_at is not None
    # is_trial stays true: "trial" records package lineage, paid_at records
    # the unlock — the quota chokepoint reads paid_at.
    assert row.is_trial is True


def test_fake_set_package_paid_is_idempotent_first_write_wins():
    db = FakeDatabase()
    package = db.create_package("jd", None, user_id="user-1")
    db.set_package_paid(package.id, "order-1", "2026-08-03T12:00:00+00:00")
    db.set_package_paid(package.id, "order-2", "2026-08-04T12:00:00+00:00")
    row = db.get_package(package.id)
    assert row.paid_at == "2026-08-03T12:00:00+00:00"
    assert row.order_id == "order-1"


def test_fake_set_package_paid_unknown_package_raises_keyerror():
    with pytest.raises(KeyError):
        FakeDatabase().set_package_paid("missing", "order-1",
                                        "2026-08-03T12:00:00+00:00")


# ------------------------------------------------- fake: touches and mints


def test_fake_touch_updated_at_stamps_both_kinds():
    db = FakeDatabase()
    package = db.create_package("jd", None)
    session = db.create_session(package.id, 1, _plan())
    db.touch_updated_at("package", package.id)
    db.touch_updated_at("session", session.id)
    assert db.get_package(package.id).updated_at is not None
    assert db.get_session(session.id).updated_at is not None


def test_fake_touch_updated_at_unknown_kind_or_id_raises():
    db = FakeDatabase()
    package = db.create_package("jd", None)
    with pytest.raises(ValueError):
        db.touch_updated_at("order", package.id)
    with pytest.raises(KeyError):
        db.touch_updated_at("package", "missing")
    with pytest.raises(KeyError):
        db.touch_updated_at("session", "missing")


def test_fake_increment_secret_mints_counts_up_and_returns_new_count():
    db = FakeDatabase()
    package = db.create_package("jd", None)
    session = db.create_session(package.id, 1, _plan())
    assert db.increment_secret_mints(session.id) == 1
    assert db.increment_secret_mints(session.id) == 2
    assert db.get_session(session.id).secret_mints == 2
    with pytest.raises(KeyError):
        db.increment_secret_mints("missing")


# ------------------------------------------------------- fake: reaper reads


def test_fake_list_stale_rows_filters_on_status_and_age():
    db = FakeDatabase()
    now = datetime.now(UTC)
    stale_iso = (now - timedelta(hours=1)).isoformat()
    fresh_iso = now.isoformat()

    stale_pkg = db.create_package("jd", None)
    fresh_pkg = db.create_package("jd", None)
    done_pkg = db.create_package("jd", None)
    db.packages[stale_pkg.id] = db.get_package(stale_pkg.id).model_copy(
        update={"updated_at": stale_iso})
    db.packages[fresh_pkg.id] = db.get_package(fresh_pkg.id).model_copy(
        update={"updated_at": fresh_iso})
    db.packages[done_pkg.id] = db.get_package(done_pkg.id).model_copy(
        update={"status": "ready", "updated_at": stale_iso})

    stale = db.list_stale_packages("compiling", older_than_s=1800)
    assert [row.id for row in stale] == [stale_pkg.id]

    session = db.create_session(stale_pkg.id, 1, _plan())
    db.set_session_status(session.id, "scoring")
    db.sessions[session.id] = db.get_session(session.id).model_copy(
        update={"updated_at": stale_iso})
    stale_sessions = db.list_stale_sessions("scoring", older_than_s=1800)
    assert [row.id for row in stale_sessions] == [session.id]
    assert db.list_stale_sessions("scoring", older_than_s=7200) == []


def test_fake_list_stale_rows_skip_null_updated_at():
    # Rows never touched (pre-batch writes) have updated_at NULL; the SQL
    # lt() filter excludes them and the fake mirrors that. Track C touches
    # updated_at on every status write, so post-batch stuck rows always
    # carry a timestamp.
    db = FakeDatabase()
    db.create_package("jd", None)
    assert db.list_stale_packages("compiling", older_than_s=0) == []


# ------------------------------------------------------ fake: compile retry


def test_fake_reset_package_for_compile_returns_row_to_compiling():
    db = FakeDatabase()
    package = db.create_package("jd", None)
    db.set_package_rubric(package.id, None, "failed")
    db.reset_package_for_compile(package.id)
    row = db.get_package(package.id)
    assert row.status == "compiling"
    assert row.updated_at is not None
    with pytest.raises(KeyError):
        db.reset_package_for_compile("missing")


# ------------------------------------------------------- supabase mappings


def test_supabase_insert_order_drops_generated_columns_and_maps():
    stored = {
        "id": "33333333-3333-3333-3333-333333333333",
        "user_id": "user-1",
        "package_id": "pkg-1",
        "polar_order_id": "polar-ord-1",
        "polar_checkout_id": "polar-chk-1",
        "amount_minor": 4900,
        "currency": "usd",
        "status": "paid",
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    stub = StubSupabase([[stored]])
    row = SupabaseDatabase(stub).insert_order(_order())
    call = stub.log[0]
    assert call["table"] == "orders"
    # id/created_at are DB-generated: a None value never rides the insert.
    assert "id" not in call["insert"]
    assert "created_at" not in call["insert"]
    assert call["insert"]["polar_order_id"] == "polar-ord-1"
    assert call["insert"]["amount_minor"] == 4900
    assert row.id == stored["id"]
    assert row.created_at == stored["created_at"]


def test_supabase_find_order_by_polar_id_maps_and_none_when_absent():
    stored = {
        "id": "33333333-3333-3333-3333-333333333333",
        "user_id": "user-1",
        "package_id": "pkg-1",
        "polar_order_id": "polar-ord-1",
        "polar_checkout_id": None,
        "amount_minor": None,
        "currency": None,
        "status": None,
        "created_at": "2026-08-03T00:00:00+00:00",
    }
    stub = StubSupabase([[stored], []])
    db = SupabaseDatabase(stub)
    row = db.find_order_by_polar_id("polar-ord-1")
    assert row is not None and row.id == stored["id"]
    assert stub.log[0]["table"] == "orders"
    assert stub.log[0]["eq"] == [("polar_order_id", "polar-ord-1")]
    assert db.find_order_by_polar_id("missing") is None


def test_supabase_list_orders_for_user_orders_by_created_at_desc():
    stub = StubSupabase([[]])
    assert SupabaseDatabase(stub).list_orders_for_user("user-1") == []
    call = stub.log[0]
    assert call["table"] == "orders"
    assert call["eq"] == [("user_id", "user-1")]
    assert call["order"] == ("created_at", True)


def test_supabase_set_package_paid_updates_paid_columns_once():
    unpaid = _package_data(status="ready", paid_at=None)
    stub = StubSupabase([[unpaid], [unpaid]])
    SupabaseDatabase(stub).set_package_paid(
        unpaid["id"], "order-1", "2026-08-03T12:00:00+00:00")
    update = stub.log[1]["update"]
    assert update["paid_at"] == "2026-08-03T12:00:00+00:00"
    assert update["expires_at"] == "2026-09-02T12:00:00+00:00"
    assert update["order_id"] == "order-1"
    assert update["total_sessions"] == PAID_TOTAL_SESSIONS
    assert "updated_at" in update
    assert stub.log[1]["eq"] == [("id", unpaid["id"])]


def test_supabase_set_package_paid_already_paid_writes_nothing():
    paid = _package_data(status="ready",
                         paid_at="2026-08-01T00:00:00+00:00",
                         expires_at="2026-08-31T00:00:00+00:00",
                         order_id="order-1")
    stub = StubSupabase([[paid]])
    SupabaseDatabase(stub).set_package_paid(
        paid["id"], "order-2", "2026-08-03T12:00:00+00:00")
    assert len(stub.log) == 1          # the read only — no second update call


def test_supabase_touch_updated_at_targets_the_right_table():
    stub = StubSupabase([[{"id": "pkg-1"}], [{"id": "sess-1"}]])
    db = SupabaseDatabase(stub)
    db.touch_updated_at("package", "pkg-1")
    db.touch_updated_at("session", "sess-1")
    assert stub.log[0]["table"] == "packages"
    assert "updated_at" in stub.log[0]["update"]
    assert stub.log[0]["eq"] == [("id", "pkg-1")]
    assert stub.log[1]["table"] == "sessions"
    with pytest.raises(ValueError):
        db.touch_updated_at("order", "x")
    stub_missing = StubSupabase([[]])
    with pytest.raises(KeyError):
        SupabaseDatabase(stub_missing).touch_updated_at("package", "missing")


def test_supabase_increment_secret_mints_reads_then_writes():
    stub = StubSupabase([[{"secret_mints": 2}], [{"id": "sess-1"}]])
    count = SupabaseDatabase(stub).increment_secret_mints("sess-1")
    assert count == 3
    assert stub.log[0]["select"] == "secret_mints"
    assert stub.log[1]["update"] == {"secret_mints": 3}
    assert stub.log[1]["eq"] == [("id", "sess-1")]
    stub_missing = StubSupabase([[]])
    with pytest.raises(KeyError):
        SupabaseDatabase(stub_missing).increment_secret_mints("missing")


def test_supabase_increment_secret_mints_null_counts_as_zero():
    # Pre-migration rows read back secret_mints NULL; the first mint is 1.
    stub = StubSupabase([[{"secret_mints": None}], [{"id": "sess-1"}]])
    assert SupabaseDatabase(stub).increment_secret_mints("sess-1") == 1


def test_supabase_list_stale_packages_filters_status_and_cutoff():
    stub = StubSupabase([[]])
    SupabaseDatabase(stub).list_stale_packages("compiling", older_than_s=1800)
    call = stub.log[0]
    assert call["table"] == "packages"
    assert ("status", "compiling") in call["eq"]
    column, cutoff = call["lt"]
    assert column == "updated_at"
    cutoff_dt = datetime.fromisoformat(cutoff)
    age_s = (datetime.now(UTC) - cutoff_dt).total_seconds()
    assert 1795 < age_s < 1805


def test_supabase_list_stale_sessions_selects_session_columns():
    stub = StubSupabase([[]])
    SupabaseDatabase(stub).list_stale_sessions("scoring", older_than_s=60)
    call = stub.log[0]
    assert call["table"] == "sessions"
    assert call["select"] == SESSION_COLUMNS
    assert ("status", "scoring") in call["eq"]
    assert call["lt"][0] == "updated_at"


def test_supabase_reset_package_for_compile_updates_status():
    stub = StubSupabase([[{"id": "pkg-1"}]])
    SupabaseDatabase(stub).reset_package_for_compile("pkg-1")
    call = stub.log[0]
    assert call["table"] == "packages"
    assert call["update"]["status"] == "compiling"
    assert "updated_at" in call["update"]
    assert call["eq"] == [("id", "pkg-1")]
    stub_missing = StubSupabase([[]])
    with pytest.raises(KeyError):
        SupabaseDatabase(stub_missing).reset_package_for_compile("missing")


def test_to_package_row_maps_the_new_columns():
    data = _package_data(is_trial=True,
                         paid_at="2026-08-03T12:00:00+00:00",
                         expires_at="2026-09-02T12:00:00+00:00",
                         order_id="44444444-4444-4444-4444-444444444444",
                         updated_at="2026-08-03T12:00:00+00:00")
    stub = StubSupabase([[data]])
    row = SupabaseDatabase(stub).get_package(data["id"])
    assert row.is_trial is True
    assert row.paid_at == data["paid_at"]
    assert row.expires_at == data["expires_at"]
    assert row.order_id == data["order_id"]
    assert row.updated_at == data["updated_at"]


def test_to_session_row_maps_the_new_columns():
    session_data = {
        "id": "22222222-2222-2222-2222-222222222222",
        "package_id": "11111111-1111-1111-1111-111111111111",
        "index": 1,
        "status": "planned",
        "session_plan": None,
        "audio_path": None,
        "report": None,
        "created_at": "2026-08-03T00:00:00+00:00",
        "updated_at": "2026-08-03T01:00:00+00:00",
        "secret_mints": 4,
    }
    stub = StubSupabase([[session_data]])
    row = SupabaseDatabase(stub).get_session(session_data["id"])
    assert row.updated_at == session_data["updated_at"]
    assert row.secret_mints == 4
