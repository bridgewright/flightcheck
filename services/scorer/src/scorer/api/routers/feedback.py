"""Phase-0 feedback route contracts."""
from fastapi import APIRouter

from scorer.api.deps import Deps
from scorer.api.responses import NotImplementedBody


def build_router(deps: Deps) -> APIRouter:
    del deps
    router = APIRouter()

    @router.post("/feedback", status_code=501, response_model=NotImplementedBody)
    def submit_feedback():
        return NotImplementedBody(error="feedback is not implemented yet")

    @router.get("/feedback", status_code=501, response_model=NotImplementedBody)
    def list_feedback(status: str | None = None, limit: int = 100):
        del status, limit
        return NotImplementedBody(error="feedback is not implemented yet")

    @router.patch("/feedback/{feedback_id}", status_code=501,
                  response_model=NotImplementedBody)
    def set_feedback_status(feedback_id: str):
        del feedback_id
        return NotImplementedBody(error="feedback is not implemented yet")

    return router
