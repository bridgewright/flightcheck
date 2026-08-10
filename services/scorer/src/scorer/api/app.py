"""FastAPI worker: assembly of the HTTP surface over the compile and scoring
pipelines.

create_app takes its collaborators (database, storage, Gemini client) as
arguments so tests exercise the real HTTP surface against fakes (house
pattern) -- no transport mocking. Auth is one bearer token
(WORKER_API_TOKEN) checked on every /api route; only /healthz is public.
Long jobs run as BackgroundTasks: POST returns 202 and clients poll GET.

The routes themselves live in api/routers/*: until v0.6 they were ~640 lines
nested in the create_app closure, which made every new endpoint a change to
one file. This module now does assembly only -- lifespan, the reaper task,
the collaborators (api/deps.py), and the router includes -- and each router
module owns its resource.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
from contextlib import asynccontextmanager, suppress
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException

from scorer.api.db import Database
from scorer.api.deps import Deps
from scorer.api.guards import AttemptCounter, FixedWindowLimiter
from scorer.api.reaper import reap_stuck_safely
from scorer.api.requestid import install_request_id
from scorer.api.routers import account, cbt, feedback, ops, orders, packages, sessions, study
from scorer.api.storage import Storage
from scorer.config import load_product_config
from scorer.intake.jd import fetch_jd
from scorer.schemas import GenAIClientLike

logger = logging.getLogger(__name__)


def _require_worker_token(authorization: Annotated[str, Header()] = "") -> None:
    """Bearer auth against WORKER_API_TOKEN. Never log or echo either value.

    compare_digest keeps the comparison constant-time so response timing
    cannot leak how much of a guessed token matched. The comparison runs on
    bytes: compare_digest raises TypeError on non-ASCII str input, so a
    one-byte header probe would otherwise turn the clean 401 into a 500.
    """
    expected = os.environ.get("WORKER_API_TOKEN", "")
    if not expected or not secrets.compare_digest(
        authorization.encode("utf-8"), f"Bearer {expected}".encode()
    ):
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


def create_app(db: Database, storage: Storage, client: GenAIClientLike) -> FastAPI:
    limits = load_product_config().limits

    async def _reaper_loop() -> None:
        while True:
            await asyncio.sleep(limits.reaper_interval_s)
            await asyncio.to_thread(
                reap_stuck_safely, db, stale_after_s=limits.reaper_stale_after_s
            )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # Startup pass: rows orphaned by the PREVIOUS container die now,
        # not one reaper interval into this one. Then the periodic task.
        await asyncio.to_thread(
            reap_stuck_safely, db, stale_after_s=limits.reaper_stale_after_s
        )
        task = asyncio.create_task(_reaper_loop())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    # Interactive docs off in every environment. FastAPI's defaults publish
    # /docs, /redoc, and /openapi.json unauthenticated, and on the public
    # Railway domain that handed anyone the full schema -- all fourteen
    # paths, request bodies included -- of the service holding customer
    # recordings. On since the worker's first commit (4c60e26, 2026-07-26)
    # and found by the v0.5 release audit. Bearer auth was, and is, enforced
    # on every /api route, so nothing leaked; this removes the free map.
    app = FastAPI(
        title="flightcheck scorer worker",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    # Before anything else can answer: an id on every response and every log
    # record, including the refusals that never reach a route.
    install_request_id(app)
    api = APIRouter(prefix="/api", dependencies=[Depends(_require_worker_token)])

    # Per-user fixed windows plus per-row attempt counters (see guards.py on
    # why process-local is honest here). Keys fall back to the package id for
    # legacy unbound rows so nothing stays uncounted.
    deps = Deps(
        db=db,
        storage=storage,
        client=client,
        limits=limits,
        package_create_limiter=FixedWindowLimiter(
            limits.package_create_window_s, limits.package_create_per_window),
        session_create_limiter=FixedWindowLimiter(
            limits.session_create_window_s, limits.session_create_per_window),
        complete_limiter=FixedWindowLimiter(
            limits.complete_window_s, limits.complete_per_window),
        feedback_limiter=FixedWindowLimiter(
            limits.feedback_window_s, limits.feedback_per_window),
        cbt_redeem_limiter=FixedWindowLimiter(
            limits.cbt_redeem_window_s, limits.cbt_redeem_per_window),
        study_limiter=FixedWindowLimiter(
            limits.study_window_s, limits.study_per_window),
        resume_attempts=AttemptCounter(),
        score_attempts=AttemptCounter(),
        compile_retry_attempts=AttemptCounter(),
        # Resolved from this module's globals at call time, so a test that
        # patches scorer.api.app.fetch_jd still reaches the intake route.
        fetch_jd=fetch_jd,
    )

    # /healthz first and outside the /api router: unprefixed and public, so
    # Railway's health check needs no token.
    app.include_router(ops.build_public_router(deps))
    for module in (packages, sessions, orders, account, cbt, feedback, study, ops):
        api.include_router(module.build_router(deps))
    app.include_router(api)
    return app


def main() -> None:
    """Deploy entrypoint: real Supabase + Gemini clients from env.

    scorer.env exposes load_env()/require_key() -- .env is authoritative
    (override=True) and a missing key fails loudly at startup (never
    load_dotenv). create_supabase_client() reads SUPABASE_URL and
    SUPABASE_SERVICE_ROLE_KEY itself; ONE Supabase client is built here
    and shared by SupabaseDatabase and SupabaseStorage (Task 2's
    composition contract).
    """
    import uvicorn

    from scorer.api.db import SupabaseDatabase, create_supabase_client
    from scorer.api.storage import SupabaseStorage
    from scorer.env import load_env, require_key
    from scorer.genai_compat import make_client
    from scorer.observability import init_sentry, setup_logging

    setup_logging()
    load_env()
    init_sentry()      # no-op unless SENTRY_DSN is set
    require_key("WORKER_API_TOKEN")
    gemini_key = require_key("GEMINI_API_KEY")
    supabase = create_supabase_client()
    app = create_app(
        db=SupabaseDatabase(supabase),
        storage=SupabaseStorage(supabase),
        client=make_client(gemini_key),
    )
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))


if __name__ == "__main__":
    main()
