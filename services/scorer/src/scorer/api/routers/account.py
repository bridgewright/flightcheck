"""Account routes: self-serve deletion (F-34, v0.6 Track A).

Phase 0 wires the endpoint and answers 501, so the path, the bearer
dependency, and the web client contract are proven by a test before four
branches build on them. Track A replaces the body with the real fan-out
(orders, sessions, reports, packages, transcripts, recording objects) via
the shared api/deletion.py module.

The user id rides as a query parameter, matching GET /api/orders: a DELETE
carrying a body is accepted unevenly by proxies and clients, and the id is
not a secret -- the bearer token is what authorizes the call.
"""
from __future__ import annotations

from fastapi import APIRouter

from scorer.api.deps import Deps
from scorer.api.responses import NotImplementedBody


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()

    @router.delete("/account", status_code=501, response_model=NotImplementedBody)
    def delete_account(user_id: str) -> NotImplementedBody:
        return NotImplementedBody(
            error="account deletion is not available yet",
        )

    return router
