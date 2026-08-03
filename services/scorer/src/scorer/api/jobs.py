"""Background jobs: everything that happens around the two pipelines.

Both are handed to FastAPI's BackgroundTasks by the routes that enqueue
them. They live in their own module (rather than beside the routes) because
they are not request code: they outlive the response, and they own the
worker's crash-safety contract.

The contract they have always kept: a background task that raises takes the
worker's event loop down with it, so nothing here may propagate. The
pipelines record their own "failed" status first; these wrappers are the
last line.

v0.6 (F-37) adds the four guards the production audit asked for, all of
them here rather than inside the pipelines, because they are about the
worker's health rather than about scoring:

* **Admission.** Scoring holds a slot from a bounded gate. Measured peak
  resident memory for a scoring run is ~1.6GB, so two at once is ~3.2GB --
  an OOM that has already killed this container and everything in flight
  with it. A run that cannot get a slot within its wait budget fails its
  own row, which leaves the customer able to retry immediately instead of
  waiting out the reaper's window.
* **Memory.** A floor checked before the recording is downloaded, so a
  container that is already nearly full refuses honestly instead of dying.
  Every start logs the observed figure: the floor cannot be tuned from
  guesses.
* **Deadline.** An overall budget bound for the whole job, checked between
  pipeline stages and before every retry attempt, so a job cannot chain
  many 480s per-call timeouts into a 50-minute thread occupation.
* **Dead letter.** Every job-level failure is recorded with a reason and
  emitted on one greppable ERROR line, so a failure is something an
  operator can see rather than something a customer reports.
"""
from __future__ import annotations

import logging
import threading
import time

from scorer.api.db import Database
from scorer.api.deadletter import (
    REASON_DEADLINE,
    REASON_LOW_MEMORY,
    REASON_NO_SLOT,
    REASON_PIPELINE_ERROR,
    default_log,
)
from scorer.api.pipeline import compile_package, score_session
from scorer.api.storage import Storage
from scorer.api.usage import scoring_latency
from scorer.resilience import (
    ConcurrencySlot,
    DeadlineExceeded,
    MemoryTooLow,
    SlotUnavailable,
    deadline_scope,
    load_resilience_config,
    require_memory,
)
from scorer.schemas import GenAIClientLike

logger = logging.getLogger(__name__)

# Statuses that already say the run is over. The wrappers must not rewrite
# one: the pipeline's own failure handler runs first and is more specific,
# and "scored"/"insufficient" are successes that merely raised on the way
# out of some later step.
_SETTLED_SESSION_STATUSES = frozenset(
    {"scored", "failed", "insufficient", "failed_permanent"})

_slots: dict[str, ConcurrencySlot] = {}
_slots_lock = threading.Lock()


def _slot(kind: str) -> ConcurrencySlot:
    """The process-wide admission gate for a job kind.

    Built lazily and cached: the gate IS the concurrency state, so building
    a second one per job would admit every job immediately.
    """
    with _slots_lock:
        slot = _slots.get(kind)
        if slot is None:
            config = getattr(load_resilience_config(), kind)
            slot = ConcurrencySlot(config.max_concurrency,
                                   wait_s=config.queue_wait_s, name=kind)
            _slots[kind] = slot
        return slot


def reset_slots() -> None:
    """Drop the cached gates (tests only; nothing in production calls it)."""
    with _slots_lock:
        _slots.clear()


def _reason_for(exc: BaseException) -> str:
    if isinstance(exc, DeadlineExceeded):
        return REASON_DEADLINE
    if isinstance(exc, SlotUnavailable):
        return REASON_NO_SLOT
    if isinstance(exc, MemoryTooLow):
        return REASON_LOW_MEMORY
    return REASON_PIPELINE_ERROR


def _fail_session_if_unsettled(db: Database, session_id: str) -> None:
    """Flip a still-running row to "failed" so the customer can retry now.

    The route sets "scoring" before enqueuing, so a job refused at the gate
    (no slot, no memory) would otherwise leave the row mid-flight until the
    reaper's window elapsed. Never raises: this runs inside the wrapper's
    own failure handler, and a database outage here must not escalate into
    a background task that kills the event loop.
    """
    try:
        if db.get_session(session_id).status in _SETTLED_SESSION_STATUSES:
            return
        db.set_session_status(session_id, "failed")
        db.touch_updated_at("session", session_id)
    except Exception:
        logger.exception(
            "could not record the failed status for session_id=%s", session_id)


def _fail_package_if_unsettled(db: Database, package_id: str) -> None:
    """The package-side mirror of _fail_session_if_unsettled."""
    try:
        if db.get_package(package_id).status in ("ready", "failed"):
            return
        db.set_package_rubric(package_id, None, "failed")
        db.touch_updated_at("package", package_id)
    except Exception:
        logger.exception(
            "could not record the failed status for package_id=%s", package_id)


def score_session_job(
    session_id: str, db: Database, storage: Storage, client: GenAIClientLike
) -> None:
    """Serialised, memory-guarded, deadline-bound scoring run.

    score_session records "failed" itself and re-raises; everything is
    swallowed here so a broken scoring job can never crash the worker.
    """
    config = load_resilience_config().scoring
    try:
        observed = require_memory(config.memory_min_available_mb, what="scoring")
        logger.info(
            "scoring session %s: available memory %s MB (floor %.0f MB)",
            session_id,
            "unknown" if observed is None else f"{observed:.0f}",
            config.memory_min_available_mb,
        )
        with _slot("scoring").acquire(), deadline_scope(config.deadline_s):
            started = time.monotonic()
            score_session(session_id, db, storage, client)
            # F-13: there is no column for a scoring run's duration and this
            # batch adds no migration, so the p50 is sampled here, in
            # process, and published with its sample size and a note saying
            # it resets on restart.
            scoring_latency().record(time.monotonic() - started)
    except Exception as exc:
        default_log().record("scoring", session_id, exc, reason=_reason_for(exc))
        _fail_session_if_unsettled(db, session_id)
        logger.exception("background scoring failed: session_id=%s", session_id)


def compile_package_job(
    package_id: str,
    db: Database,
    storage: Storage,
    client: GenAIClientLike,
    *,
    resume_text: str | None,
    linkedin_text: str | None,
) -> None:
    """Deadline-bound compile run, mirroring score_session_job.

    compile_package records "failed" itself, but if even that status write
    throws (a double fault, e.g. a database outage) everything is swallowed
    here so the background task can never crash the worker. Compilation is
    not memory-bound the way scoring is -- it holds text, not a decoded wav
    -- so its gate is wider and its memory floor is off by default.
    """
    config = load_resilience_config().compile
    try:
        require_memory(config.memory_min_available_mb, what="compile")
        with _slot("compile").acquire(), deadline_scope(config.deadline_s):
            compile_package(
                package_id,
                db,
                storage,
                client,
                resume_text=resume_text,
                linkedin_text=linkedin_text,
            )
    except Exception as exc:
        default_log().record("compile", package_id, exc, reason=_reason_for(exc))
        _fail_package_if_unsettled(db, package_id)
        logger.exception("background compile failed: package_id=%s", package_id)
