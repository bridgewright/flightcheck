"""F-37 dead-letter path: permanently failed jobs are recorded and visible.

The audit's finding was not that jobs fail -- they will -- but that when one
does, nothing an operator looks at says so. The row's status reads "failed"
with no reason attached, and the traceback goes to a log stream nobody
watches. Failures were discovered by customer complaint.

Two halves, deliberately:

* **Durable**: the row's own "failed" status, written by the pipeline. That
  survives a container death and is what the customer's retry acts on.
* **Fresh**: this bounded in-process log, holding WHY each recent job died,
  served by GET /api/ops/dead-letters, plus one ERROR line per failure
  carrying the stable "dead-letter" marker so log-based alerting (Track C's
  F-36 wiring) has something unambiguous to key on.

Both entry points record: the job wrappers (api/jobs.py) catch what escapes
a pipeline, and compile_package -- which handles its own failure and does
not re-raise -- records before it swallows. Otherwise the commonest failure
in the product, a compile that dies on a provider error, would set the row
to "failed" and appear nowhere an operator looks.

The in-process half is explicitly not durable: it is bounded process memory
and empties on restart. That is the honest trade available without a new
table, and it is the half that answers "what just broke", which is the
question the durable half cannot answer at all.
"""
from __future__ import annotations

import logging
import threading
from collections import deque
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from scorer.resilience import (
    DeadlineExceeded,
    MemoryTooLow,
    SlotUnavailable,
    load_resilience_config,
)

logger = logging.getLogger(__name__)

JobKind = Literal["scoring", "compile"]

# Stable reasons, so an operator (and an alert rule) can tell a provider
# outage from a capacity problem without reading tracebacks.
REASON_PIPELINE_ERROR = "pipeline-error"
REASON_DEADLINE = "deadline"
REASON_NO_SLOT = "no-slot"
REASON_LOW_MEMORY = "low-memory"


def reason_for(exc: BaseException) -> str:
    """The stable reason for a failure. Here rather than in api/jobs.py so
    a pipeline that handles its own failure classifies it the same way the
    job wrapper would."""
    if isinstance(exc, DeadlineExceeded):
        return REASON_DEADLINE
    if isinstance(exc, SlotUnavailable):
        return REASON_NO_SLOT
    if isinstance(exc, MemoryTooLow):
        return REASON_LOW_MEMORY
    return REASON_PIPELINE_ERROR


class DeadLetter(BaseModel):
    """One permanently failed job run."""

    model_config = ConfigDict(extra="forbid")

    kind: JobKind
    subject_id: str            # session id or package id
    reason: str
    error_type: str
    detail: str                # truncated, single-line; never a secret
    occurred_at: str           # UTC ISO


class DeadLetterLog:
    """Bounded, thread-safe ring of recent job failures.

    Thread-safe because background jobs run in FastAPI's worker threads and
    the operator endpoint reads from the event loop's own thread.
    """

    def __init__(self, max_records: int, detail_max_chars: int = 300):
        self._records: deque[DeadLetter] = deque(maxlen=max_records)
        self._lock = threading.Lock()
        self._detail_max_chars = detail_max_chars
        self._total = 0

    @property
    def max_records(self) -> int:
        return self._records.maxlen or 0

    @property
    def total_recorded(self) -> int:
        """Every failure ever recorded, including ones the ring dropped."""
        with self._lock:
            return self._total

    def record(self, kind: JobKind, subject_id: str, exc: BaseException, *,
               reason: str) -> DeadLetter:
        detail = " ".join(str(exc).split())[:self._detail_max_chars]
        entry = DeadLetter(
            kind=kind,
            subject_id=subject_id,
            reason=reason,
            error_type=type(exc).__name__,
            detail=detail,
            occurred_at=datetime.now(UTC).isoformat(),
        )
        with self._lock:
            self._records.append(entry)
            self._total += 1
        # One line, one marker. Alert rules key on "dead-letter"; everything
        # an operator needs to triage without opening a traceback is on it.
        logger.error(
            "dead-letter: kind=%s id=%s reason=%s error=%s detail=%s",
            entry.kind, entry.subject_id, entry.reason, entry.error_type,
            entry.detail,
        )
        return entry

    def recent(self, limit: int | None = None) -> list[DeadLetter]:
        """Newest first, capped at `limit` when given."""
        with self._lock:
            records = list(self._records)
        records.reverse()
        return records if limit is None else records[:limit]


_default_log: DeadLetterLog | None = None
_default_lock = threading.Lock()


def default_log() -> DeadLetterLog:
    """The process-wide log. Built lazily so importing this module never
    reads config, and shared so jobs and the ops route see one history."""
    global _default_log
    with _default_lock:
        if _default_log is None:
            config = load_resilience_config().deadletter
            _default_log = DeadLetterLog(
                config.max_records, detail_max_chars=config.detail_max_chars)
        return _default_log


def reset_default_log() -> None:
    """Drop the process-wide log (tests only; nothing in production calls it)."""
    global _default_log
    with _default_lock:
        _default_log = None
