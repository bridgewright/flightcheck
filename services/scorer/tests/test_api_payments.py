"""Route contracts for the v0.5 payment provisioning surface (F-10/F-24).

POST /api/packages/{id}/paid is called by the web's Polar webhook (via
markPackagePaid) and must be replay-safe: idempotent on polar_order_id,
first-write-wins on the package's paid state. GET /api/orders feeds the
OrderHistory receipts list.
"""
import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

ORDER_BODY = {
    "user_id": "user-1",
    "polar_order_id": "polar-order-1",
    "polar_checkout_id": "polar-checkout-1",
    "amount_minor": 4900,
    "currency": "USD",
    "status": "paid",
    "paid_at": "2026-08-03T12:00:00+00:00",
}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)


def _client(db: FakeDatabase) -> TestClient:
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([])))


def test_paid_provisions_order_and_package_state():
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    client = _client(db)

    response = client.post(f"/api/packages/{package.id}/paid",
                           json=ORDER_BODY, headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["package_id"] == package.id
    assert body["duplicate"] is False
    order = db.find_order_by_polar_id("polar-order-1")
    assert order is not None
    assert body["order_id"] == order.id
    assert order.user_id == "user-1"
    assert order.package_id == package.id
    assert order.amount_minor == 4900
    updated = db.get_package(package.id)
    assert updated.paid_at == "2026-08-03T12:00:00+00:00"
    assert updated.expires_at == "2026-09-02T12:00:00+00:00"
    assert updated.order_id == order.id
    assert updated.total_sessions == 6
    assert updated.is_trial is True    # the flag records history, never flips


def test_paid_is_idempotent_on_polar_order_id():
    # A replayed webhook must provision nothing new and NEVER move the
    # expiry window.
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    client = _client(db)
    first = client.post(f"/api/packages/{package.id}/paid",
                        json=ORDER_BODY, headers=AUTH)
    expires_before = db.get_package(package.id).expires_at

    replay = client.post(
        f"/api/packages/{package.id}/paid",
        json={**ORDER_BODY, "paid_at": "2026-08-20T00:00:00+00:00"},
        headers=AUTH,
    )

    assert replay.status_code == 200
    assert replay.json()["duplicate"] is True
    assert replay.json()["order_id"] == first.json()["order_id"]
    assert len(db.orders) == 1
    assert db.get_package(package.id).expires_at == expires_before


def test_paid_survives_a_lost_insert_race():
    # Two webhook deliveries can pass the find-first probe together; the
    # loser's unique-violation insert must still answer 200, not 500.
    db = FakeDatabase()
    package = ready_package(db, is_trial=True)
    client = _client(db)
    assert client.post(f"/api/packages/{package.id}/paid",
                       json=ORDER_BODY, headers=AUTH).status_code == 200

    real_find = db.find_order_by_polar_id
    calls = {"count": 0}

    def racing_find(polar_order_id):
        calls["count"] += 1
        if calls["count"] == 1:
            return None            # the probe loses the race to the insert
        return real_find(polar_order_id)

    db.find_order_by_polar_id = racing_find
    replay = client.post(f"/api/packages/{package.id}/paid",
                         json=ORDER_BODY, headers=AUTH)

    assert replay.status_code == 200
    assert replay.json()["duplicate"] is True
    assert len(db.orders) == 1


def test_paid_unknown_package_is_404_and_writes_nothing():
    db = FakeDatabase()
    client = _client(db)
    response = client.post("/api/packages/missing/paid",
                           json=ORDER_BODY, headers=AUTH)
    assert response.status_code == 404
    assert db.orders == {}


def test_paid_rejects_a_user_mismatch():
    # Provisioning someone else's package is a webhook-resolution bug, not a
    # write: refuse loudly and record nothing.
    db = FakeDatabase()
    package = ready_package(db, user_id="user-1")
    client = _client(db)

    response = client.post(
        f"/api/packages/{package.id}/paid",
        json={**ORDER_BODY, "user_id": "someone-else"},
        headers=AUTH,
    )

    assert response.status_code == 409
    assert response.json()["code"] == "user-mismatch"
    assert db.orders == {}
    assert db.get_package(package.id).paid_at is None


def test_paid_accepts_an_unbound_package():
    # Legacy unbound packages have no user_id to mismatch; the order's
    # user_id comes from the webhook's resolution.
    db = FakeDatabase()
    package = ready_package(db, user_id=None)
    client = _client(db)
    response = client.post(f"/api/packages/{package.id}/paid",
                           json=ORDER_BODY, headers=AUTH)
    assert response.status_code == 200
    assert db.get_package(package.id).paid_at is not None


def test_paid_rejects_a_malformed_timestamp():
    db = FakeDatabase()
    package = ready_package(db)
    client = _client(db)
    response = client.post(
        f"/api/packages/{package.id}/paid",
        json={**ORDER_BODY, "paid_at": "yesterday-ish"},
        headers=AUTH,
    )
    assert response.status_code == 422
    assert db.orders == {}


def test_paid_requires_auth():
    db = FakeDatabase()
    package = ready_package(db)
    client = _client(db)
    assert client.post(f"/api/packages/{package.id}/paid",
                       json=ORDER_BODY).status_code == 401


def test_orders_lists_newest_first_for_one_user():
    db = FakeDatabase()
    package = ready_package(db, user_id="user-1")
    client = _client(db)
    for suffix in ("a", "b"):
        client.post(
            f"/api/packages/{package.id}/paid",
            json={**ORDER_BODY, "polar_order_id": f"polar-{suffix}"},
            headers=AUTH,
        )

    response = client.get("/api/orders", params={"user_id": "user-1"},
                          headers=AUTH)

    assert response.status_code == 200
    orders = response.json()["orders"]
    assert [order["polar_order_id"] for order in orders] == ["polar-b", "polar-a"]
    assert orders[0]["user_id"] == "user-1"
    assert orders[0]["amount_minor"] == 4900

    other = client.get("/api/orders", params={"user_id": "someone-else"},
                       headers=AUTH)
    assert other.json() == {"orders": []}


def test_orders_requires_the_user_id_param_and_auth():
    db = FakeDatabase()
    client = _client(db)
    assert client.get("/api/orders", headers=AUTH).status_code == 422
    assert client.get("/api/orders", params={"user_id": "u"}).status_code == 401
