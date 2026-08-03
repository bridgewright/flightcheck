"""Preview routes: the landing page's unauthenticated rubric preview
(F-45, v0.6 Track D).

Phase 0 wires the endpoint and answers 501. Track D implements the cheap
compile path behind it -- dimensions and weights only, no research sweep, no
question bank, no session, nothing persisted -- plus the guards that make an
LLM call reachable from a public page survivable: a per-IP window, a global
daily ceiling, a JD length cap enforced before any model call, and a hard
timeout.

The worker endpoint itself stays behind the bearer token like every other
/api route. The public exposure is the web's own /api/preview route, which
calls this one server-side.

RubricPreview below is the response contract, declared here in Phase 0 and
mirrored field-for-field in apps/web/lib/types.ts so Track D and the web
route cannot drift. Failures -- including the honest degraded state above
the daily ceiling -- ride the existing typed error channel ({error, code}),
not a variant of this shape.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from scorer.api.deps import Deps
from scorer.api.responses import NotImplementedBody


class PreviewRubricRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jd_text: str


class PreviewDimension(BaseModel):
    """One scoring dimension, stripped to what a stranger needs to see: what
    it is called, how much it counts, and which channel judges it."""

    model_config = ConfigDict(extra="forbid")

    key: str
    name: str
    weight: float
    channel: str  # "content" | "delivery"


class RubricPreview(BaseModel):
    """The bar a JD compiles to, without anything worth stealing or storing:
    no question bank, no BARS anchors, no research summary, no citations."""

    model_config = ConfigDict(extra="forbid")

    role_title: str
    company: str | None
    dimensions: list[PreviewDimension]


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()

    @router.post("/preview/rubric", status_code=501,
                 response_model=NotImplementedBody)
    def preview_rubric(body: PreviewRubricRequest) -> NotImplementedBody:
        return NotImplementedBody(
            error="rubric preview is not available yet",
        )

    return router
