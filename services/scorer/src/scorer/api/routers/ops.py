"""Operator routes: liveness and usage metrics.

Two routers, because these two endpoints do not share a security posture:

* build_public_router carries /healthz -- NOT under /api and NOT behind the
  bearer token, which is what makes it usable as Railway's health check.
  Moved from create_app unchanged; v0.6 Track C (F-36) makes it check what
  it claims, because returning true unconditionally is a liveness lie that
  once let a dead build keep serving.
* build_router carries the /api endpoints, bearer-authed like every other:
  GET /metrics/usage (F-13) and GET /ops/dead-letters (F-37). Both answer
  the operator's two standing questions -- how is the product being used,
  and what broke -- without opening the database by hand.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from scorer.api.deadletter import default_log
from scorer.api.deps import Deps
from scorer.api.usage import UsageMetrics, compute_usage
from scorer.resilience import load_resilience_config

# One request cannot dump the whole ring: this is an operator endpoint, not
# an export. The ceiling is the bound, the default is what fits on a screen.
_DEAD_LETTER_DEFAULT_LIMIT = 50
_DEAD_LETTER_MAX_LIMIT = 200


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    db = deps.db

    @router.get("/metrics/usage")
    def usage_metrics() -> UsageMetrics:
        """The three PRD success metrics, aggregated from existing columns.

        Every rate ships with the counts behind it and with
        `distinct_users`, because "N=1 account" is the most important fact
        about every number this product can currently produce, and the
        repo's honesty rule (impression rule 7) turns on saying so. The
        `notes` list carries the caveats in prose so a report generated
        from this payload cannot accidentally drop them.
        """
        scan_limit = load_resilience_config().metrics.usage_scan_limit
        return compute_usage(
            db.list_recent_packages(scan_limit),
            db.list_recent_sessions(scan_limit),
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
