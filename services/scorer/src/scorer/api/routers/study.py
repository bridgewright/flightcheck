"""Phase-0 package study route contracts."""
from fastapi import APIRouter

from scorer.api.deps import Deps
from scorer.api.responses import NotImplementedBody


def build_router(deps: Deps) -> APIRouter:
    del deps
    router = APIRouter()

    def unavailable():
        return NotImplementedBody(error="study materials are not implemented yet")

    router.add_api_route("/packages/{package_id}/study", unavailable,
                         methods=["POST"], status_code=501,
                         response_model=NotImplementedBody)
    router.add_api_route("/packages/{package_id}/study", unavailable,
                         methods=["GET"], status_code=501,
                         response_model=NotImplementedBody)
    router.add_api_route("/packages/{package_id}/bookmarks", unavailable,
                         methods=["GET"], status_code=501,
                         response_model=NotImplementedBody)
    return router
