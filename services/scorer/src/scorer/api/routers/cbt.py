"""Closed-beta access-code redemption."""
from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from scorer.api.deps import Deps
from scorer.api.responses import rate_limited


class RedeemCbtRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    code: str


def _refusal(status: int, code: str, error: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "error": error})


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()

    @router.post("/cbt/redeem")
    def redeem(body: RedeemCbtRequest):
        normalized = body.code.strip().upper()
        if not body.user_id.strip() or not normalized or len(normalized) > 64:
            return _refusal(422, "cbt-code-invalid", "enter a valid access code")
        if not deps.cbt_redeem_limiter.hit(body.user_id):
            return rate_limited("cbt-redeem")
        if deps.db.get_cbt_redemption_by_user(body.user_id) is not None:
            return _refusal(409, "cbt-already-redeemed",
                            "this account has already redeemed beta access")
        code_hash = hashlib.sha256(normalized.encode()).hexdigest()
        code = deps.db.find_cbt_code_by_hash(code_hash)
        if code is None:
            return _refusal(404, "cbt-code-invalid", "that access code is not recognized")
        expires = datetime.fromisoformat(code.package_expires_at)
        if code.disabled_at is not None or expires <= datetime.now(UTC):
            return _refusal(410, "cbt-closed", "this beta has closed")
        if deps.db.count_cbt_redemptions(code.id) >= code.max_redemptions:
            return _refusal(409, "cbt-full", "this beta is full")
        # Accepted race: two simultaneous accounts may overshoot the cap by
        # one under the single worker process; the shared cap remains bounded.
        deps.db.insert_cbt_redemption(code.id, body.user_id)
        return {"label": code.label, "packages_remaining": 3,
                "package_expires_at": code.package_expires_at}

    return router
