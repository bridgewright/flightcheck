"""Order routes: the receipts feed.

Provisioning lives on the package resource (POST /packages/{id}/paid in
packages.py) because that is what its path says and what it writes; this
module is the read side an account sees.
"""
from __future__ import annotations

from fastapi import APIRouter

from scorer.api.deps import Deps


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    db = deps.db

    @router.get("/orders")
    def list_orders(user_id: str) -> dict:
        """A user's orders, newest first — the OrderHistory receipts feed."""
        return {"orders": [
            order.model_dump(mode="json")
            for order in db.list_orders_for_user(user_id)
        ]}

    return router
