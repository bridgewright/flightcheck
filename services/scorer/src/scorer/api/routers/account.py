"""Account routes: self-serve deletion (F-34, v0.6 Track A).

The work itself lives in api/deletion.py, which the operator CLI
(tools/purge_user.py) calls too -- one implementation, so "delete my
account" cannot come to mean two different things depending on who
triggered it. This module is only the HTTP shape around that.

The user id rides as a query parameter, matching GET /api/orders: a DELETE
carrying a body is accepted unevenly by proxies and clients, and the id is
not a secret -- the bearer token is what authorizes the call. Checking that
the id is the CALLER'S OWN happens one layer up, in the web route, which
reads it from the signed-in session and never from user input.
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from scorer.api.deletion import (
    RecordingsNotDeleted,
    collect_deletion_plan,
    execute_deletion,
)
from scorer.api.deps import Deps

logger = logging.getLogger(__name__)


class DeletionCounts(BaseModel):
    """What actually went away -- the caller is told, not reassured."""

    model_config = ConfigDict(extra="forbid")

    packages: int
    sessions: int
    orders: int
    recordings: int
    feedback: int


class AccountDeletionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deleted: DeletionCounts


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    db = deps.db
    storage = deps.storage

    @router.delete("/account", response_model=AccountDeletionResponse)
    def delete_account(
        # min_length=1: `?user_id=` is a client bug, and answering 200 to it
        # ("that account owned nothing") would hide the bug behind a
        # plausible success.
        user_id: Annotated[str, Query(min_length=1)],
    ):
        cleaned = user_id.strip()
        if not cleaned:
            return JSONResponse(
                status_code=422,
                content={"error": "user_id must not be blank",
                         "code": "invalid-user-id"},
            )
        plan = collect_deletion_plan(db, cleaned)
        redemption = db.get_cbt_redemption_by_user(cleaned)
        try:
            outcome = execute_deletion(db, storage, plan)
        except RecordingsNotDeleted:
            # Blobs go before rows, so this failure means the account is
            # entirely intact -- say exactly that. The web route must then
            # leave the sign-in record alone so the customer can retry.
            logger.warning(
                "account deletion aborted: %d recording object(s) survived",
                len(plan.recording_paths))
            return JSONResponse(
                status_code=503,
                content={
                    "error": "we could not delete your recordings just now, "
                             "so nothing was deleted and your account is "
                             "unchanged. Try again in a few minutes.",
                    "code": "recordings-not-deleted",
                },
            )
        if redemption is not None:
            db.delete_rows("cbt_redemption", [redemption.id])
        # Counts only, never the id: a deletion that leaves the account id
        # sitting in a log aggregator has not deleted much. The request-id
        # middleware is what correlates this line with the rest of the call.
        logger.info(
            "account deleted: %d package(s), %d session(s), %d order(s), "
            "%d recording(s)", outcome.packages_deleted,
            outcome.sessions_deleted, outcome.orders_deleted,
            outcome.recordings_deleted)
        return AccountDeletionResponse(deleted=DeletionCounts(
            packages=outcome.packages_deleted,
            sessions=outcome.sessions_deleted,
            orders=outcome.orders_deleted,
            recordings=outcome.recordings_deleted,
            feedback=outcome.feedback_deleted,
        ))

    return router
