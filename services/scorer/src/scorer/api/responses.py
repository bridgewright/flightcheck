"""Shared JSON bodies for answers more than one router gives.

Kept in one place so the machine-readable `code` a client switches on cannot
drift between routers: the web's typed WorkerError reads exactly these keys.
"""
from __future__ import annotations

from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict


def rate_limited(action: str) -> JSONResponse:
    """The 429 every fixed-window refusal returns."""
    return JSONResponse(
        status_code=429,
        content={
            "error": f"too many {action} attempts just now — wait a few "
                     "minutes and try again",
            "code": "rate-limited",
        },
    )


class NotImplementedBody(BaseModel):
    """The body of an endpoint that exists but does not work yet.

    Phase 0 of the v0.6 batch wires three endpoints ahead of the tracks that
    implement them, so the routing, the bearer auth, and the client contract
    are proven by a test rather than assumed by four parallel branches. Each
    answers 501 with this body until its track lands: an honest "not yet",
    never a fake success and never a misleading 404.
    """

    model_config = ConfigDict(extra="forbid")

    error: str
    code: str = "not-implemented"
