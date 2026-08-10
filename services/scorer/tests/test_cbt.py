from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.db import CbtCodeRow
from scorer.api.quota import is_expired
from scorer.api.usage import compute_usage


def _client(monkeypatch, db: FakeDatabase) -> TestClient:
    monkeypatch.setenv("WORKER_API_TOKEN", "test-token")
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([])))


def _code(db: FakeDatabase, plaintext: str = "FC-CBT-TEST") -> CbtCodeRow:
    row = CbtCodeRow(
        id="code-1", code_hash=hashlib.sha256(plaintext.encode()).hexdigest(),
        label="Founding cohort", max_redemptions=2,
        package_expires_at=(datetime.now(UTC) + timedelta(days=2)).isoformat(),
    )
    db.cbt_codes[row.id] = row
    return row


def test_redeem_normalizes_and_returns_entitlement(monkeypatch):
    db = FakeDatabase()
    code = _code(db)
    response = _client(monkeypatch, db).post(
        "/api/cbt/redeem", headers={"Authorization": "Bearer test-token"},
        json={"user_id": "user-1", "code": "  fc-cbt-test  "},
    )
    assert response.status_code == 200
    assert response.json() == {
        "label": "Founding cohort", "packages_remaining": 3,
        "package_expires_at": code.package_expires_at,
    }


def test_a_tool_minted_code_redeems_at_the_endpoint(monkeypatch):
    # The round trip the beta depends on: the hash the mint tool stores is
    # the hash the endpoint computes, including the normalization of what a
    # participant actually types (padding, lowercase).
    from mint_cbt_code import generate_code, hash_code

    db = FakeDatabase()
    plaintext = generate_code()
    row = CbtCodeRow(
        id="code-1", code_hash=hash_code(plaintext), label="Founding cohort",
        max_redemptions=2,
        package_expires_at=(datetime.now(UTC) + timedelta(days=2)).isoformat(),
    )
    db.cbt_codes[row.id] = row
    response = _client(monkeypatch, db).post(
        "/api/cbt/redeem", headers={"Authorization": "Bearer test-token"},
        json={"user_id": "user-1", "code": f"  {plaintext.lower()}  "},
    )
    assert response.status_code == 200
    assert response.json()["label"] == "Founding cohort"


def test_redeem_refusals_do_not_leak_later_state(monkeypatch):
    db = FakeDatabase()
    code = _code(db)
    db.insert_cbt_redemption(code.id, "user-1")
    client = _client(monkeypatch, db)
    headers = {"Authorization": "Bearer test-token"}
    already = client.post("/api/cbt/redeem", headers=headers,
                          json={"user_id": "user-1", "code": "wrong"})
    assert already.json()["code"] == "cbt-already-redeemed"
    invalid = client.post("/api/cbt/redeem", headers=headers,
                          json={"user_id": "user-2", "code": "wrong"})
    assert (invalid.status_code, invalid.json()["code"]) == (404, "cbt-code-invalid")


def test_redeem_validation_refuses_with_422(monkeypatch):
    db = FakeDatabase()
    _code(db)
    client = _client(monkeypatch, db)
    headers = {"Authorization": "Bearer test-token"}
    empty = client.post("/api/cbt/redeem", headers=headers,
                        json={"user_id": "user-1", "code": "   "})
    assert (empty.status_code, empty.json()["code"]) == (422, "cbt-code-invalid")
    oversize = client.post("/api/cbt/redeem", headers=headers,
                           json={"user_id": "user-1", "code": "x" * 65})
    assert oversize.status_code == 422
    blank_user = client.post("/api/cbt/redeem", headers=headers,
                             json={"user_id": "   ", "code": "FC-CBT-TEST"})
    assert blank_user.status_code == 422


def test_rate_limited_caller_learns_nothing_about_the_code(monkeypatch):
    # Order pins: validation (422) precedes the limiter; the limiter (429)
    # precedes every database read, so a rate-limited caller cannot probe
    # whether a code exists, and the window is per account, not global.
    db = FakeDatabase()
    _code(db)
    client = _client(monkeypatch, db)
    headers = {"Authorization": "Bearer test-token"}
    for _ in range(10):  # cbt_redeem_per_window in product.toml
        wrong = client.post("/api/cbt/redeem", headers=headers,
                            json={"user_id": "user-1", "code": "WRONG"})
        assert wrong.status_code == 404
    limited = client.post("/api/cbt/redeem", headers=headers,
                          json={"user_id": "user-1", "code": "FC-CBT-TEST"})
    assert (limited.status_code, limited.json()["code"]) == (429, "rate-limited")
    still_invalid = client.post("/api/cbt/redeem", headers=headers,
                                json={"user_id": "user-1", "code": "   "})
    assert still_invalid.status_code == 422
    fresh_account = client.post("/api/cbt/redeem", headers=headers,
                                json={"user_id": "user-2", "code": "FC-CBT-TEST"})
    assert fresh_account.status_code == 200


def test_a_disabled_code_refuses_with_410(monkeypatch):
    db = FakeDatabase()
    code = _code(db)
    db.cbt_codes[code.id] = code.model_copy(
        update={"disabled_at": datetime.now(UTC).isoformat()})
    response = _client(monkeypatch, db).post(
        "/api/cbt/redeem", headers={"Authorization": "Bearer test-token"},
        json={"user_id": "user-1", "code": "FC-CBT-TEST"})
    assert (response.status_code, response.json()["code"]) == (410, "cbt-closed")


def test_a_past_package_expiry_closes_the_beta(monkeypatch):
    db = FakeDatabase()
    code = _code(db)
    db.cbt_codes[code.id] = code.model_copy(update={
        "package_expires_at":
            (datetime.now(UTC) - timedelta(seconds=1)).isoformat()})
    response = _client(monkeypatch, db).post(
        "/api/cbt/redeem", headers={"Authorization": "Bearer test-token"},
        json={"user_id": "user-1", "code": "FC-CBT-TEST"})
    assert (response.status_code, response.json()["code"]) == (410, "cbt-closed")


def test_a_full_beta_refuses_with_409_and_closed_outranks_full(monkeypatch):
    db = FakeDatabase()
    code = _code(db)  # max_redemptions=2
    db.insert_cbt_redemption(code.id, "user-a")
    db.insert_cbt_redemption(code.id, "user-b")
    client = _client(monkeypatch, db)
    headers = {"Authorization": "Bearer test-token"}
    full = client.post("/api/cbt/redeem", headers=headers,
                       json={"user_id": "user-c", "code": "FC-CBT-TEST"})
    assert (full.status_code, full.json()["code"]) == (409, "cbt-full")
    # A beta both closed and full says closed: the earlier refusal must not
    # leak the later state (that the cap was reached).
    db.cbt_codes[code.id] = code.model_copy(
        update={"disabled_at": datetime.now(UTC).isoformat()})
    closed = client.post("/api/cbt/redeem", headers=headers,
                         json={"user_id": "user-d", "code": "FC-CBT-TEST"})
    assert (closed.status_code, closed.json()["code"]) == (410, "cbt-closed")
    # And the caller's own account state outranks everything about the code.
    already = client.post("/api/cbt/redeem", headers=headers,
                          json={"user_id": "user-a", "code": "FC-CBT-TEST"})
    assert (already.status_code, already.json()["code"]) == (
        409, "cbt-already-redeemed")


def test_account_deletion_removes_only_its_redemption(monkeypatch):
    db = FakeDatabase()
    code = _code(db)
    first = db.insert_cbt_redemption(code.id, "user-1")
    other = db.insert_cbt_redemption(code.id, "user-2")
    response = _client(monkeypatch, db).delete(
        "/api/account?user_id=user-1",
        headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert first.id not in db.cbt_redemptions
    assert db.cbt_redemptions[other.id].user_id == "user-2"


def test_operator_purge_removes_the_redemption_row():
    # tools/purge_user.py calls ONLY the shared deletion module (F-34: the
    # endpoint and the CLI must never disagree about what "delete my
    # account" means), so the sweep itself must remove the redemption row --
    # a bolt-on in the router leaves the operator path incomplete. The user
    # here owns nothing else, which also pins that a redemption-only
    # account does not early-return as an empty plan.
    from scorer.api.deletion import collect_deletion_plan, execute_deletion

    db = FakeDatabase()
    code = _code(db)
    mine = db.insert_cbt_redemption(code.id, "user-1")
    other = db.insert_cbt_redemption(code.id, "user-2")
    execute_deletion(db, FakeStorage(), collect_deletion_plan(db, "user-1"))
    assert mine.id not in db.cbt_redemptions
    assert db.cbt_redemptions[other.id].user_id == "user-2"


def test_usage_counts_cbt_inside_comped_without_changing_other_counts():
    db = FakeDatabase()
    package = db.create_package("jd", None, user_id="user-1")
    db.set_package_cbt(package.id, datetime.now(UTC).isoformat(),
                       (datetime.now(UTC) + timedelta(days=1)).isoformat(), "code-1")
    usage = compute_usage([db.get_package(package.id)], [])
    assert usage.comped_packages_sampled == 1
    assert usage.cbt_packages_sampled == 1
    assert usage.paid_packages_sampled == 0


def test_cbt_grant_counter_survives_package_deletion(monkeypatch):
    db = FakeDatabase()
    code = _code(db)
    redemption = db.insert_cbt_redemption(code.id, "user-1")
    monkeypatch.setattr("scorer.api.routers.packages.compile_package_job",
                        lambda *args, **kwargs: None)
    client = _client(monkeypatch, db)
    headers = {"Authorization": "Bearer test-token"}
    created = []
    for _ in range(3):
        response = client.post("/api/packages", headers=headers,
                               json={"user_id": "user-1", "jd_text": "Software engineer role"})
        created.append(db.get_package(response.json()["package_id"]))
    assert all(row.comped_at is not None for row in created)
    db.delete_rows("package", [created[0].id])
    fourth = client.post("/api/packages", headers=headers,
                         json={"user_id": "user-1", "jd_text": "Software engineer role"})
    fourth_row = db.get_package(fourth.json()["package_id"])
    assert db.cbt_redemptions[redemption.id].packages_granted == 3
    assert fourth_row.comped_at is None
    assert fourth_row.expires_at is None


def test_cbt_expiry_uses_existing_package_expiry_guard():
    db = FakeDatabase()
    package = db.create_package("jd", None, user_id="user-1")
    db.set_package_cbt(package.id, datetime.now(UTC).isoformat(),
                       (datetime.now(UTC) - timedelta(seconds=1)).isoformat(),
                       "code-1")
    assert is_expired(db.get_package(package.id)) is True
