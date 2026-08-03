"""Route-layer contracts the v0.6 tracks build against.

Phase 0 split the ~640-line create_app closure into api/routers/*. Three of
those modules were wired ahead of the tracks that implemented them, answering
501, so the routing, the bearer dependency, and the request contract were
proven here rather than assumed on four parallel branches. All three have
since landed; what remains pinned is the posture they must keep.

These tests pin what a track may NOT change while implementing its endpoint:
the path, the auth posture, and the required parameters the web client
already sends.
"""
import inspect

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.deps import Deps
from scorer.api.routers import account, ops, orders, packages, preview, sessions

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(FakeDatabase(), FakeStorage(), FakeGenAI([])))


# --- the module contract -------------------------------------------------


ROUTER_MODULES = (packages, sessions, orders, account, preview, ops)


@pytest.mark.parametrize(
    "module", ROUTER_MODULES, ids=[m.__name__.rsplit(".", 1)[-1] for m in ROUTER_MODULES]
)
def test_every_router_module_exposes_the_same_builder(module):
    # The one signature four tracks code against: build_router(deps) -> APIRouter.
    # eval_str resolves the PEP 563 string annotations these modules carry.
    signature = inspect.signature(module.build_router, eval_str=True)
    assert list(signature.parameters) == ["deps"]
    assert signature.parameters["deps"].annotation is Deps
    assert signature.return_annotation is APIRouter
    assert isinstance(module.build_router(_deps()), APIRouter)


def _deps() -> Deps:
    from scorer.api.guards import AttemptCounter, FixedWindowLimiter
    from scorer.config import load_product_config

    limits = load_product_config().limits
    return Deps(
        db=FakeDatabase(),
        storage=FakeStorage(),
        client=FakeGenAI([]),
        limits=limits,
        package_create_limiter=FixedWindowLimiter(60, 10),
        session_create_limiter=FixedWindowLimiter(60, 10),
        complete_limiter=FixedWindowLimiter(60, 10),
        resume_attempts=AttemptCounter(),
        score_attempts=AttemptCounter(),
        compile_retry_attempts=AttemptCounter(),
        fetch_jd=lambda url: "",
    )


def test_deps_is_frozen():
    # The limiters ARE the rate-limit state; rebinding one mid-process would
    # silently reset every window.
    deps = _deps()
    with pytest.raises(Exception):
        deps.db = FakeDatabase()


# --- /healthz keeps its posture after the move ---------------------------


def test_healthz_is_public_and_not_under_the_api_prefix(client):
    # It now reports what it checked rather than an unconditional true (F-36),
    # but the posture this test exists for is unchanged: reachable, and public.
    body = client.get("/healthz").json()
    assert body["ok"] is True
    assert body["checks"]["database"] == "ok"
    # Moving it into routers/ops.py must not quietly put it behind the
    # bearer dependency or the /api prefix: Railway's health check has
    # neither a token nor that path.
    assert client.get("/api/healthz").status_code == 404


# --- the three endpoints wired ahead of their tracks ---------------------


# Every endpoint Phase 0 wired ahead of its track is now implemented: DELETE
# /api/account by F-34, POST /api/preview/rubric by F-45, GET
# /api/metrics/usage by F-13. The 501 table and its test retired with them.
# What stays pinned here is what a track may never change while implementing
# an endpoint — where it lives and who may reach it. The request contracts
# moved to tests/test_api_account.py, test_api_preview.py and test_api_usage.py.
WIRED = (
    ("DELETE", "/api/account", {"params": {"user_id": "user-1"}}),
    ("POST", "/api/preview/rubric", {"json": {"jd_text": "We are hiring."}}),
    ("GET", "/api/metrics/usage", {}),
)


@pytest.mark.parametrize(
    "method,path,kwargs", WIRED,
    ids=["account-delete", "preview-rubric", "metrics-usage"],
)
def test_wired_endpoint_is_behind_the_bearer_token(client, method, path, kwargs):
    assert client.request(method, path, **kwargs).status_code == 401


def test_account_deletion_requires_the_user_id(client):
    # The web client sends it as a query parameter (DELETE bodies are
    # handled unevenly by proxies); a missing id is a 422, never a
    # delete-everyone.
    assert client.delete("/api/account", headers=AUTH).status_code == 422


def test_rubric_preview_requires_jd_text_and_refuses_extra_keys(client):
    assert client.post("/api/preview/rubric", json={}, headers=AUTH).status_code == 422
    over = client.post(
        "/api/preview/rubric",
        json={"jd_text": "We are hiring.", "user_id": "user-1"},
        headers=AUTH,
    )
    assert over.status_code == 422


def test_rubric_preview_shape_carries_dimensions_and_weights_only():
    # Declared in Phase 0 so Track D and the web route cannot drift. What is
    # absent is the point: no question bank, no anchors, no research summary.
    fields = set(preview.RubricPreview.model_fields)
    assert fields == {"role_title", "company", "dimensions"}
    assert set(preview.PreviewDimension.model_fields) == {
        "key", "name", "weight", "channel",
    }
