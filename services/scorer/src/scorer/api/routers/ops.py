"""Operator routes: liveness and usage metrics.

Two routers, because these two endpoints do not share a security posture:

* build_public_router carries /healthz -- NOT under /api and NOT behind the
  bearer token, which is what makes it usable as Railway's health check.
  Moved from create_app unchanged; v0.6 Track C (F-36) makes it check what
  it claims, because returning true unconditionally is a liveness lie that
  once let a dead build keep serving.
* build_router carries the /api endpoints, bearer-authed like every other:
  GET /metrics/usage, wired here in Phase 0 answering 501 and implemented by
  Track B (F-13) as session completion rate, p50 latencies, and package
  burn-through aggregated from existing columns.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from scorer.api.deadletter import default_log
from scorer.api.deps import Deps
from scorer.api.responses import NotImplementedBody

# One request cannot dump the whole ring: this is an operator endpoint, not
# an export. The ceiling is the bound, the default is what fits on a screen.
_DEAD_LETTER_DEFAULT_LIMIT = 50
_DEAD_LETTER_MAX_LIMIT = 200


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()

    @router.get("/metrics/usage", status_code=501,
                response_model=NotImplementedBody)
    def usage_metrics() -> NotImplementedBody:
        return NotImplementedBody(
            error="usage metrics are not available yet",
        )

    @router.get("/ops/dead-letters")
    def dead_letters(
        limit: Annotated[
            int, Query(ge=1, le=_DEAD_LETTER_MAX_LIMIT)
        ] = _DEAD_LETTER_DEFAULT_LIMIT,
    ) -> dict:
        """Recent permanently failed jobs, newest first (F-37).

        Process-local and bounded, and honest about it: this answers "what
        just broke", which is the question the durable record (each row's
        own "failed" status) cannot answer. total_recorded counts every
        failure since this worker started, including the ones the ring has
        already dropped, so a truncated list never reads as a quiet worker.
        """
        log = default_log()
        records = log.recent(limit=limit)
        return {
            "records": [entry.model_dump(mode="json") for entry in records],
            "returned": len(records),
            "total_recorded": log.total_recorded,
        }

    return router


def build_public_router(deps: Deps) -> APIRouter:
    """The unauthenticated, unprefixed surface. One route, deliberately."""
    router = APIRouter()

    @router.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    return router
