"""Preview routes: the landing page's unauthenticated rubric preview
(F-45, v0.6 Track D).

The cheap compile path, its guards, and the wire shape all live in
scorer/api/preview.py; this module is the HTTP skin over them. The models
are re-exported here because the Phase 0 contract test reads them off this
module and because apps/web/lib/types.ts mirrors them field-for-field.

The worker endpoint stays behind the bearer token like every other /api
route. The public exposure is the web's own /api/preview route, which calls
this one server-side and adds the per-visitor IP window this layer cannot
see (the worker's client is the web app, not the browser).

Failures -- including the honest degraded state above the daily ceiling --
ride the existing typed error channel ({error, code}), never a variant of
the success shape.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from scorer.api import preview as preview_module
from scorer.api.deps import Deps
from scorer.api.preview import (
    PreviewDimension,
    PreviewGate,
    PreviewRefused,
    RubricPreview,
    check_jd_text,
    compile_preview,
)

__all__ = [
    "PreviewDimension",
    "PreviewRubricRequest",
    "RubricPreview",
    "build_router",
]

# Callers arriving without a resolvable peer (ASGI transports may omit it)
# share one window rather than escaping the limiter entirely.
_UNKNOWN_CALLER = "-unknown-"


class PreviewRubricRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jd_text: str


def _refusal(refused: PreviewRefused) -> JSONResponse:
    return JSONResponse(
        status_code=refused.status_code,
        content={"error": refused.message, "code": refused.code},
    )


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter()
    client = deps.client
    # Read through the module, not off a from-import: the limits are the one
    # knob an operator (or a test) narrows, and binding them at import time
    # would freeze the copy this file happened to see first.
    limits = preview_module.PREVIEW_LIMITS
    # One gate per app, so the windows and the in-flight slots are the
    # process's real history (guards.py explains why process-local is the
    # honest bound for this worker).
    gate = PreviewGate(limits)

    @router.post("/preview/rubric", response_model=RubricPreview)
    def preview_rubric(body: PreviewRubricRequest, request: Request):
        try:
            # The cap runs first and outside the gate: an out-of-bounds
            # paste must not cost a rate-limit slot, let alone a model call.
            jd_text = check_jd_text(body.jd_text, limits)
            caller = request.client.host if request.client else _UNKNOWN_CALLER
            return gate.run(caller, lambda: compile_preview(jd_text, client, limits))
        except PreviewRefused as refused:
            return _refusal(refused)

    return router
