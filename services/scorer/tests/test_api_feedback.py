import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.db import FeedbackRow
from scorer.config import load_product_config

TOKEN = "feedback-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def worker_env(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)


def client(monkeypatch, db=None, **limits):
    if limits:
        cfg = load_product_config()
        monkeypatch.setattr("scorer.api.app.load_product_config", lambda: cfg.model_copy(
            update={"limits": cfg.limits.model_copy(update=limits)}))
    database = db or FakeDatabase()
    return TestClient(create_app(database, FakeStorage(), FakeGenAI([]))), database


def payload(**changes):
    return {"user_id": "user-1", "rating_half_stars": 7, "body": "Useful", **changes}


def test_submit_and_list(monkeypatch):
    api, db = client(monkeypatch)
    created = api.post("/api/feedback", json=payload(), headers=AUTH)
    assert created.status_code == 201
    response = api.get("/api/feedback", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["returned"] == 1
    assert response.json()["feedback"][0]["id"] == created.json()["feedback_id"]
    assert len(db.feedback) == 1


def test_rate_limit_refuses_sixth_hit(monkeypatch):
    api, db = client(monkeypatch, feedback_per_window=5)
    for _ in range(5):
        assert api.post("/api/feedback", json=payload(), headers=AUTH).status_code == 201
    refused = api.post("/api/feedback", json=payload(), headers=AUTH)
    assert refused.status_code == 429
    assert refused.json()["code"] == "rate-limited"
    assert len(db.feedback) == 5


def test_absolute_cap(monkeypatch):
    db = FakeDatabase()
    db.insert_feedback(FeedbackRow(user_id="user-1", rating_half_stars=8, body=""))
    api, _ = client(monkeypatch, db, max_feedback_per_user=1)
    refused = api.post("/api/feedback", json=payload(), headers=AUTH)
    assert refused.status_code == 429
    assert refused.json()["code"] == "feedback-cap"


def test_oversize_body_inserts_nothing(monkeypatch):
    api, db = client(monkeypatch, feedback_text_max_chars=3)
    response = api.post("/api/feedback", json=payload(body="four"), headers=AUTH)
    assert response.status_code == 422
    assert db.feedback == []


def test_limiter_answers_before_the_length_check(monkeypatch):
    """Guard order, not just guard presence: a caller who is already over the
    window gets the rate-limit refusal even when the body is also too long.
    Reversing the two would leak the cheaper 422 to someone being throttled."""
    api, db = client(monkeypatch, feedback_per_window=1, feedback_text_max_chars=3)
    assert api.post("/api/feedback", json=payload(body="ok"),
                    headers=AUTH).status_code == 201
    refused = api.post("/api/feedback", json=payload(body="far too long"),
                       headers=AUTH)
    assert refused.status_code == 429
    assert refused.json()["code"] == "rate-limited"
    assert len(db.feedback) == 1


def test_cap_answers_before_the_length_check(monkeypatch):
    db = FakeDatabase()
    db.insert_feedback(FeedbackRow(user_id="user-1", rating_half_stars=8, body=""))
    api, _ = client(monkeypatch, db, max_feedback_per_user=1,
                    feedback_text_max_chars=3)
    refused = api.post("/api/feedback", json=payload(body="far too long"),
                       headers=AUTH)
    assert refused.status_code == 429
    assert refused.json()["code"] == "feedback-cap"


def test_package_must_exist_and_belong_to_submitter(monkeypatch):
    db = FakeDatabase()
    own = ready_package(db, user_id="user-1")
    foreign = ready_package(db, user_id="user-2")
    api, _ = client(monkeypatch, db)
    missing = api.post("/api/feedback", json=payload(package_id="missing"), headers=AUTH)
    other = api.post("/api/feedback", json=payload(package_id=foreign.id), headers=AUTH)
    accepted = api.post("/api/feedback", json=payload(package_id=own.id), headers=AUTH)
    assert missing.status_code == 404
    assert other.status_code == 404
    assert accepted.status_code == 201


def test_list_filter_validation_and_limit(monkeypatch):
    db = FakeDatabase()
    db.insert_feedback(FeedbackRow(user_id="u", rating_half_stars=2, body="a"))
    seen = db.insert_feedback(FeedbackRow(user_id="u", rating_half_stars=4, body="b"))
    db.set_feedback_status(seen.id or "", "seen")
    api, _ = client(monkeypatch, db)
    rows = api.get("/api/feedback?status=seen&limit=1", headers=AUTH).json()
    assert rows["returned"] == 1 and rows["feedback"][0]["status"] == "seen"
    assert api.get("/api/feedback?status=bad", headers=AUTH).status_code == 422
    assert api.get("/api/feedback?limit=201", headers=AUTH).status_code == 422


def test_list_defaults_to_fifty_newest_first(monkeypatch):
    """The Phase 0 stub defaulted to 100; the contract is 50. Nothing else
    pins the default, so a silent drift back would ship an unbounded-feeling
    inbox with no failing test."""
    db = FakeDatabase()
    for index in range(60):
        db.insert_feedback(FeedbackRow(user_id="u", rating_half_stars=2,
                                       body=str(index)))
    api, _ = client(monkeypatch, db)
    rows = api.get("/api/feedback", headers=AUTH).json()
    assert rows["returned"] == 50
    assert rows["feedback"][0]["body"] == "59"


def test_patch_contract(monkeypatch):
    db = FakeDatabase()
    row = db.insert_feedback(FeedbackRow(user_id="u", rating_half_stars=6, body=""))
    api, _ = client(monkeypatch, db)
    changed = api.patch(f"/api/feedback/{row.id}", json={"status": "seen"}, headers=AUTH)
    assert changed.json() == {"feedback_id": row.id, "status": "seen"}
    missing = api.patch("/api/feedback/missing", json={"status": "seen"}, headers=AUTH)
    invalid = api.patch(f"/api/feedback/{row.id}", json={"status": "bad"}, headers=AUTH)
    assert missing.status_code == 404
    assert invalid.status_code == 422


@pytest.mark.parametrize("method,path,json", [
    ("post", "/api/feedback", payload()),
    ("get", "/api/feedback", None),
    ("patch", "/api/feedback/id", {"status": "seen"}),
])
def test_auth_required(monkeypatch, method, path, json):
    api, _ = client(monkeypatch)
    assert api.request(method, path, json=json).status_code == 401
