"""F-45 landing rubric preview: the cheap compile a stranger can reach.

Every other LLM call in this product sits behind an account and, past the
trial session, behind a payment. This one sits behind a paste box on the
landing page, because the single most useful thing flightcheck can show
someone who has never signed up is the bar they would be measured against
(nobody candidate-side does this today). That makes it a spend lever
pointed at us, and this module is written as one.

**Cheaper than the paid compile, on purpose.** No research sweep, no corpus
excerpts, no few-shot rubrics, no BARS anchors, no question bank, and no
retry: one structured call that answers "what does this role get scored on,
and how much does each part count". The paid compile in rubric/compiler.py
is the thing being previewed, not the thing being run.

**Four guards, in the order they cost.**

1. A length cap on the JD, enforced before anything is spent. Both ends: an
   over-long paste is spend, and a six-word paste is spend on nothing.
2. A per-caller burst window, reusing api/guards.py's FixedWindowLimiter.
3. A global daily ceiling -- the same limiter with a 24h window and one
   fixed key. Above it the endpoint refuses honestly ("the preview is busy;
   sign in and compile yours for real"), never queues.
4. A concurrency slot plus a hard deadline, so a hung provider bounds the
   request rather than the request bounding on the provider.

**Layering note.** The worker sees the web app as its client, not the
visitor, so the burst window here is a service-level bound; the true
per-visitor IP window lives in the web route that fronts this one
(apps/web/app/api/preview/guard.ts). Both are real: this one is what still
holds if the worker URL and token ever leak.

**Nothing is persisted.** This module imports no Database and no Storage,
which is the enforcement, not a promise: there is nothing here to write
with. A preview is a look at the bar, not an account.

Limits live in this module rather than config/product.toml because that file
belongs to another track for the duration of the v0.6 batch; PREVIEW_LIMITS
is one frozen dataclass so moving them later is a one-line change.
"""
from __future__ import annotations

import logging
import math
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, TypeVar

from google.genai import types
from pydantic import BaseModel, ConfigDict, ValidationError

from scorer.api.guards import FixedWindowLimiter
from scorer.config import load_product_config
from scorer.promptsafe import fence, strip_hidden_text
from scorer.schemas import GenAIClientLike

logger = logging.getLogger(__name__)

T = TypeVar("T")

# One key for the global window: the daily ceiling is a property of the
# service, not of any caller.
_GLOBAL_KEY = "-preview-global-"
_DAY_S = 86400.0


@dataclass(frozen=True)
class PreviewLimits:
    """Every bound the preview path enforces, in one place.

    Sized against what the endpoint is for: a visitor pastes one JD, maybe
    two. Anything that looks like more than curiosity is refused rather than
    served slowly.
    """

    # A JD shorter than this is not a JD; longer than this is not worth
    # previewing. The paid path's cap (limits.jd_compile_max_chars) is
    # deliberately larger -- that one is a customer who paid for depth.
    jd_min_chars: int = 120
    jd_max_chars: int = 10000

    # Per-caller burst window.
    burst_window_s: float = 600.0
    burst_per_window: int = 30

    # The day's free previews. Reached, the endpoint says so.
    daily_ceiling: int = 300

    # In-flight previews and how long any one of them may hold a request.
    max_concurrency: int = 2
    timeout_s: float = 30.0

    # What counts as a bar rather than noise coming back from the model.
    min_dimensions: int = 3
    max_dimensions: int = 8


PREVIEW_LIMITS = PreviewLimits()


# --- the wire shape ------------------------------------------------------
#
# Declared here rather than in the router because this module owns the
# domain; routers/preview.py re-exports them so the Phase 0 contract test
# still finds them there.


class PreviewDimension(BaseModel):
    """One scoring dimension, stripped to what a stranger needs to see: what
    it is called, how much it counts, and which channel judges it."""

    model_config = ConfigDict(extra="forbid")

    key: str
    name: str
    weight: float
    channel: Literal["content", "delivery"]


class RubricPreview(BaseModel):
    """The bar a JD compiles to, without anything worth stealing or storing:
    no question bank, no BARS anchors, no research summary, no citations."""

    model_config = ConfigDict(extra="forbid")

    role_title: str
    company: str | None
    dimensions: list[PreviewDimension]


# --- refusals ------------------------------------------------------------


class PreviewRefused(Exception):
    """A preview that will not happen, in terms the web can render.

    Every failure mode of this endpoint is one of these: the route has no
    other exit. `message` is written to be shown to a stranger verbatim, so
    it never carries a provider's words, a stack, or an internal limit.
    """

    status_code = 500
    code = "preview-failed"
    message = "the preview did not work this time"

    def __init__(self, message: str | None = None):
        super().__init__(message or self.message)
        if message is not None:
            self.message = message


class PreviewTooShort(PreviewRefused):
    status_code = 422
    code = "preview-too-short"
    message = ("that is too short to compile a bar from — paste the full job "
               "description")


class PreviewTooLong(PreviewRefused):
    status_code = 422
    code = "preview-too-long"
    message = ("that job description is longer than the preview takes — paste "
               "the role and requirements sections")


class PreviewRateLimited(PreviewRefused):
    status_code = 429
    code = "preview-rate-limited"
    message = ("that is a few previews in a short while — give it a minute, or "
               "sign in and compile yours for real")


class PreviewSaturated(PreviewRefused):
    status_code = 429
    code = "preview-busy"
    message = ("the preview is busy right now — sign in and compile yours for "
               "real")


class PreviewCeilingReached(PreviewRefused):
    status_code = 429
    code = "preview-ceiling"
    message = ("the preview is busy right now — sign in and compile yours for "
               "real")


class PreviewTimeout(PreviewRefused):
    status_code = 504
    code = "preview-timeout"
    message = ("the preview took too long to come back — try again, or sign in "
               "and compile yours for real")


class PreviewFailed(PreviewRefused):
    status_code = 502
    code = "preview-failed"
    message = ("the preview did not come back in a shape we can show — try "
               "again, or sign in and compile yours for real")


# --- the length cap ------------------------------------------------------


def check_jd_text(jd_text: str, limits: PreviewLimits = PREVIEW_LIMITS) -> str:
    """Clean the pasted JD and refuse it if it is out of bounds.

    Runs before anything is reserved or spent -- an out-of-bounds paste must
    cost a rate-limit slot as little as it costs a model call. Hidden-text
    stripping happens here so the length that is measured is the length that
    reaches the prompt (a payload hidden in HTML comments would otherwise
    pass a cap it does not actually respect).
    """
    cleaned = strip_hidden_text(jd_text).strip()
    if len(cleaned) < limits.jd_min_chars:
        raise PreviewTooShort()
    if len(cleaned) > limits.jd_max_chars:
        raise PreviewTooLong()
    return cleaned


# --- the prompt ----------------------------------------------------------

_PREVIEW_RULES = (
    "## STRICT RULES\n"
    "- Produce 4 to 6 dimensions, each with a unique kebab-case key and a short\n"
    "  human-readable name.\n"
    '- Exactly one dimension must have channel "delivery" (how the candidate sounds:\n'
    '  pacing, composure, spoken clarity). The rest are channel "content".\n'
    "- Weights are fractions of 1.0 and must sum to 1.0 across all dimensions. Weight\n"
    "  them by how much this specific role would actually turn on each one.\n"
    "- Set role_title from the job description, in the job description's own words.\n"
    "  Set company when the job description names one, otherwise null.\n"
    "- Name what THIS role is scored on. A dimension that would fit any job is a\n"
    "  wasted row.\n"
    "Return only JSON matching the response schema."
)


def build_preview_prompt(jd_text: str) -> str:
    """The whole prompt: a fenced JD and the shape we want back.

    Compare rubric/compiler.py, which also carries research findings, corpus
    excerpts, few-shot rubrics, and the rules for anchors and a question
    bank. None of that is here, and that difference IS the preview.
    """
    return (
        "You are reading a job description and naming the dimensions a real\n"
        "interview for that role would score, with how much each one counts.\n\n"
        f"## JOB DESCRIPTION\n{fence('JOB DESCRIPTION', jd_text)}\n\n"
        f"{_PREVIEW_RULES}"
    )


# --- normalization -------------------------------------------------------


def normalize_preview(raw: RubricPreview,
                      limits: PreviewLimits = PREVIEW_LIMITS) -> RubricPreview:
    """Turn a model reply into something honest to display, or refuse it.

    Rescaling rather than rejecting near-miss weights is deliberate: the
    signal a visitor reads off this screen is the RELATIVE emphasis between
    dimensions, and a model that answers in percentages has communicated
    that correctly. What cannot be rescaled into meaning -- no dimensions,
    too few, too many, duplicate keys, no delivery row, weights that do not
    sum to anything positive -- is refused instead of patched, because a
    patched bar would be a made-up bar.
    """
    dimensions = raw.dimensions
    if not (limits.min_dimensions <= len(dimensions) <= limits.max_dimensions):
        raise PreviewFailed()
    if len({dim.key for dim in dimensions}) != len(dimensions):
        raise PreviewFailed()
    if all(dim.channel != "delivery" for dim in dimensions):
        # Delivery is scored from raw audio and is half of what this product
        # sells; a bar without it is not this product's bar.
        raise PreviewFailed()
    total = sum(dim.weight for dim in dimensions)
    if not math.isfinite(total) or total <= 0:
        raise PreviewFailed()
    if any(not math.isfinite(dim.weight) or dim.weight < 0 for dim in dimensions):
        raise PreviewFailed()
    company = (raw.company or "").strip()
    return RubricPreview(
        role_title=raw.role_title.strip(),
        company=company or None,
        dimensions=[
            dim.model_copy(update={"weight": round(dim.weight / total, 4)})
            for dim in dimensions
        ],
    )


# --- the gate ------------------------------------------------------------


class PreviewGate:
    """Burst window, daily ceiling, concurrency slot, and deadline.

    One instance per app (built in the router's build_router), so the
    windows are the process's actual history the way every other limiter in
    this service is -- see guards.py on why process-local is honest here.

    Ordering is the point. The burst window runs first because it is the
    cheapest check and the most targeted. The concurrency slot runs BEFORE
    the daily ceiling so that a caller who can only saturate the slots
    cannot burn the day's free previews without a single model call ever
    happening -- otherwise the cheapest attack on this endpoint would be to
    exhaust the budget for everyone else at zero cost to us.
    """

    def __init__(self, limits: PreviewLimits = PREVIEW_LIMITS):
        self._limits = limits
        self._burst = FixedWindowLimiter(limits.burst_window_s, limits.burst_per_window)
        self._daily = FixedWindowLimiter(_DAY_S, limits.daily_ceiling)
        self._slots = threading.Semaphore(limits.max_concurrency)

    def run(self, caller_key: str, call: Callable[[], T]) -> T:
        """Run `call` under every guard, or raise the PreviewRefused that says why."""
        if not self._burst.hit(caller_key):
            raise PreviewRateLimited()
        if not self._slots.acquire(blocking=False):
            raise PreviewSaturated()
        try:
            if not self._daily.hit(_GLOBAL_KEY):
                raise PreviewCeilingReached()
        except BaseException:
            self._slots.release()
            raise
        return self._run_with_deadline(call)

    def _run_with_deadline(self, call: Callable[[], T]) -> T:
        """Bound the REQUEST at timeout_s; the slot stays held until the call
        really ends.

        A synchronous provider SDK cannot be cancelled, so the honest split
        is: the visitor waits a bounded time, and the in-flight spend keeps
        occupying its concurrency slot until it finishes. Releasing the slot
        at the deadline would let a hung provider accumulate unbounded
        background calls, which is the failure this guard exists to prevent.
        """
        outcome: dict[str, object] = {}

        def runner() -> None:
            try:
                outcome["value"] = call()
            except BaseException as exc:  # noqa: BLE001 - re-raised on the caller's thread
                outcome["error"] = exc
            finally:
                self._slots.release()

        thread = threading.Thread(target=runner, name="rubric-preview", daemon=True)
        thread.start()
        thread.join(self._limits.timeout_s)
        if thread.is_alive():
            raise PreviewTimeout()
        error = outcome.get("error")
        if error is not None:
            raise error  # type: ignore[misc]
        return outcome["value"]  # type: ignore[return-value]


# --- the compile ---------------------------------------------------------


def compile_preview(jd_text: str, client: GenAIClientLike,
                    limits: PreviewLimits = PREVIEW_LIMITS) -> RubricPreview:
    """One structured call -> a displayable bar. No retry, by design.

    The paid compiler repairs a validation failure with a second call. Here
    that would double the spend a stranger can trigger on the failure path,
    so a bad reply degrades to the honest "did not come back in a shape we
    can show" state instead. The provider's own exception text is logged and
    dropped, never surfaced.
    """
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=RubricPreview,
    )
    try:
        response = client.models.generate_content(
            model=load_product_config().models.scorer,
            contents=build_preview_prompt(jd_text),
            config=config,
        )
    except Exception:
        logger.exception("rubric preview: the model call failed")
        raise PreviewFailed() from None
    try:
        raw = RubricPreview.model_validate_json(response.text or "")
    except ValidationError:
        logger.warning("rubric preview: the model reply did not validate")
        raise PreviewFailed() from None
    return normalize_preview(raw, limits)
