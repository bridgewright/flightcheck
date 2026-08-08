"""Stored customer feedback and its operator read feed."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from scorer.api.db import FEEDBACK_STATUSES, FeedbackRow
from scorer.api.deps import Deps
from scorer.api.responses import rate_limited


class SubmitFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str
    rating_half_stars: int = Field(ge=1, le=10)
    body: str
    package_id: str | None = None


class FeedbackCreated(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback_id: str


class FeedbackList(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback: list[FeedbackRow]
    returned: int


class SetStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str


class StatusChanged(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback_id: str
    status: str


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    db = deps.db
    limits = deps.limits

    @router.post("/feedback", status_code=201, response_model=FeedbackCreated)
    def submit_feedback(body: SubmitFeedbackRequest):
        if not deps.feedback_limiter.hit(body.user_id):
            return rate_limited("feedback")
        if len(db.list_feedback_for_user(body.user_id)) >= limits.max_feedback_per_user:
            return JSONResponse(status_code=429, content={
                "error": "feedback limit reached — contact support to raise it",
                "code": "feedback-cap",
            })
        if len(body.body) > limits.feedback_text_max_chars:
            return JSONResponse(status_code=422, content={
                "error": "feedback is too long — shorten it and try again",
            })
        if body.package_id is not None:
            try:
                package = db.get_package(body.package_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail="package not found") from exc
            if package.user_id != body.user_id:
                raise HTTPException(status_code=404, detail="package not found")
        stored = db.insert_feedback(FeedbackRow(**body.model_dump()))
        assert stored.id is not None
        return FeedbackCreated(feedback_id=stored.id)

    @router.get("/feedback", response_model=FeedbackList)
    def list_feedback(status: str | None = None,
                      limit: int = Query(default=50, ge=1, le=200)):
        if status is not None and status not in FEEDBACK_STATUSES:
            raise HTTPException(status_code=422, detail="invalid feedback status")
        rows = db.list_feedback(status, limit)
        return FeedbackList(feedback=rows, returned=len(rows))

    @router.patch("/feedback/{feedback_id}", response_model=StatusChanged)
    def set_feedback_status(feedback_id: str, body: SetStatusRequest):
        if body.status not in FEEDBACK_STATUSES:
            raise HTTPException(status_code=422, detail="invalid feedback status")
        try:
            db.set_feedback_status(feedback_id, body.status)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="feedback not found") from exc
        return StatusChanged(feedback_id=feedback_id, status=body.status)

    return router
