"""F-37 worker survival primitives: retry, deadline, memory, concurrency.

The scoring pipeline is a long chain of expensive, network-bound calls over
a resource the customer cannot reproduce: a 20-minute interview recorded
once. Three failure modes were audited in production and all three are
handled here rather than in each call site:

* **Transient provider failures.** A 429 or a dropped connection is
  pressure, not a defect. Before v0.6 exactly one of the model call sites
  retried; transcription -- the most expensive and least replaceable step --
  had none, so a single blip discarded the whole recording's value.
* **Unbounded wall time.** Each Gemini call carries a 480s HTTP timeout
  (genai_compat.GEMINI_HTTP_TIMEOUT_MS). Chained across a compile or a
  scoring run, that is a job that can hold a worker thread for the better
  part of an hour. A Deadline is checked between stages and before every
  attempt, so a job that has run out of budget never buys another call.
* **Memory.** Scoring downloads the recording whole and decodes it to wav;
  measured peak resident memory is ~1.6GB. Two concurrent runs OOMed this
  worker once already, so scoring runs one at a time behind a
  ConcurrencySlot, with a memory floor in front of it.

This module deliberately lives outside ``scorer.api``: the domain modules
(content, delivery, rubric, intake, research) call ``call_with_retry``, and
domain code must not import from the API layer.

Configuration is ``config/resilience.toml`` -- no limit here is a code
constant.
"""
from __future__ import annotations

import contextvars
import logging
import random as _random
import threading
import time
import tomllib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

import httpx
from google.genai import errors as genai_errors
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "resilience.toml"

# cgroup v1 writes a near-2^63 sentinel rather than a flag when a container
# has no memory limit; anything at or above this is "unlimited".
_CGROUP_V1_UNLIMITED = 1 << 62


class RetryConfig(BaseModel):
    """Transient-failure backoff, shared by every outbound model call."""

    model_config = ConfigDict(extra="forbid")

    max_attempts: int
    initial_backoff_s: float
    backoff_multiplier: float
    max_backoff_s: float
    jitter_ratio: float


class JobConfig(BaseModel):
    """Per-job-kind concurrency, queueing, deadline, and memory floor."""

    model_config = ConfigDict(extra="forbid")

    max_concurrency: int
    queue_wait_s: float
    deadline_s: float
    memory_min_available_mb: float


class DeadLetterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_records: int


class ResilienceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    retry: RetryConfig
    scoring: JobConfig
    compile: JobConfig
    deadletter: DeadLetterConfig


def load_resilience_config() -> ResilienceConfig:
    """Load and validate config/resilience.toml (extra="forbid" throughout,
    so a typo in the TOML fails at load time instead of being ignored)."""
    return ResilienceConfig.model_validate(tomllib.loads(CONFIG_PATH.read_text()))


# ------------------------------------------------------------------ deadline


class DeadlineExceeded(Exception):
    """The job ran out of its overall time budget."""


class Deadline:
    """A monotonic wall-clock budget for one background job.

    Checked at pipeline stage boundaries and before every retry attempt.
    It cannot interrupt a call already in flight -- these are synchronous
    SDK calls -- so the honest guarantee is: a job overruns by at most one
    in-flight call's timeout, never by the sum of every remaining one.
    """

    def __init__(self, budget_s: float,
                 monotonic: Callable[[], float] = time.monotonic):
        self._monotonic = monotonic
        self._budget_s = budget_s
        self._started = monotonic()

    @property
    def budget_s(self) -> float:
        return self._budget_s

    @property
    def elapsed_s(self) -> float:
        return self._monotonic() - self._started

    @property
    def remaining_s(self) -> float:
        return max(0.0, self._budget_s - self.elapsed_s)

    @property
    def expired(self) -> bool:
        return self.remaining_s <= 0.0

    def check(self, step: str) -> None:
        """Raise DeadlineExceeded when there is no budget left for `step`."""
        if self.expired:
            raise DeadlineExceeded(
                f"job deadline of {self._budget_s:.0f}s exceeded before "
                f"{step!r} (elapsed {self.elapsed_s:.0f}s)"
            )


_current_deadline: contextvars.ContextVar[Deadline | None] = contextvars.ContextVar(
    "scorer_job_deadline", default=None
)


def current_deadline() -> Deadline | None:
    """The deadline of the job running on this thread, or None outside one."""
    return _current_deadline.get()


@contextmanager
def deadline_scope(
    budget_s: float, monotonic: Callable[[], float] = time.monotonic
) -> Iterator[Deadline]:
    """Bind a Deadline for the duration of a job.

    A ContextVar rather than a parameter threaded through eight call sites:
    background jobs run one per thread (FastAPI runs sync BackgroundTasks in
    a worker thread), so the binding reaches every nested call without
    changing the signature of every domain function on the way down.
    """
    deadline = Deadline(budget_s, monotonic=monotonic)
    token = _current_deadline.set(deadline)
    try:
        yield deadline
    finally:
        _current_deadline.reset(token)


# --------------------------------------------------------------------- retry


def is_transient(exc: BaseException) -> bool:
    """True for provider pressure and transport failures, false for bugs.

    429 and 5xx are the API saying "not now"; 4xx below 429 is the API
    saying "this request is wrong", which retrying only makes more
    expensive. Parse and validation failures are ours, never the network's.
    """
    if isinstance(exc, genai_errors.APIError):
        return exc.code == 429 or (exc.code is not None and exc.code >= 500)
    if isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, TimeoutError | ConnectionError)


def call_with_retry[T](
    fn: Callable[[], T],
    *,
    what: str,
    retry: RetryConfig | None = None,
    sleep: Callable[[float], None] = time.sleep,
    jitter: Callable[[], float] = _random.random,
) -> T:
    """Call `fn`, retrying transient failures with capped, jittered backoff.

    `what` names the step in the logs and in the DeadlineExceeded message --
    it is the only thing that tells an operator which of a scoring run's ten
    model calls was the one under pressure.

    Deadline interaction is the load-bearing part: an attempt is never
    started, and a backoff is never slept, once the job's remaining budget
    cannot cover it. A retry policy without that check is how a job turns
    three 480s timeouts into a 24-minute thread occupation.
    """
    policy = retry if retry is not None else load_resilience_config().retry
    delay = policy.initial_backoff_s
    last: BaseException | None = None
    for attempt in range(1, policy.max_attempts + 1):
        deadline = current_deadline()
        if deadline is not None and deadline.expired:
            raise DeadlineExceeded(
                f"job deadline exceeded before attempt {attempt} of {what!r}"
            ) from last
        try:
            return fn()
        except Exception as exc:
            if not is_transient(exc):
                raise
            last = exc
            if attempt == policy.max_attempts:
                logger.warning(
                    "%s failed after %d transient attempts; giving up",
                    what, attempt,
                )
                raise
            wait = min(delay * (1.0 + policy.jitter_ratio * jitter()),
                       policy.max_backoff_s)
            deadline = current_deadline()
            if deadline is not None and deadline.remaining_s <= wait:
                raise DeadlineExceeded(
                    f"job deadline leaves {deadline.remaining_s:.0f}s, less "
                    f"than the {wait:.0f}s backoff {what!r} needs"
                ) from exc
            logger.warning(
                "transient failure in %s (attempt %d/%d: %s); retrying in %.1fs",
                what, attempt, policy.max_attempts, exc, wait,
            )
            sleep(wait)
            delay = min(delay * policy.backoff_multiplier, policy.max_backoff_s)
    raise AssertionError("unreachable: the loop returns or raises")  # pragma: no cover


# -------------------------------------------------------------------- memory


def _read_int(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def _cgroup_v2_available_bytes(root: Path) -> int | None:
    base = root / "sys/fs/cgroup"
    try:
        raw = (base / "memory.max").read_text().strip()
    except OSError:
        return None
    if raw == "max":
        return None            # no container limit: fall through to the host
    try:
        limit = int(raw)
    except ValueError:
        return None
    used = _read_int(base / "memory.current")
    if used is None:
        return None
    return max(0, limit - used)


def _cgroup_v1_available_bytes(root: Path) -> int | None:
    base = root / "sys/fs/cgroup/memory"
    limit = _read_int(base / "memory.limit_in_bytes")
    if limit is None or limit >= _CGROUP_V1_UNLIMITED:
        return None
    used = _read_int(base / "memory.usage_in_bytes")
    if used is None:
        return None
    return max(0, limit - used)


def _meminfo_available_bytes(root: Path) -> int | None:
    try:
        text = (root / "proc/meminfo").read_text()
    except OSError:
        return None
    for line in text.splitlines():
        if line.startswith("MemAvailable:"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1]) * 1024
    return None


def available_memory_mb(root: Path = Path("/")) -> float | None:
    """Memory this process can still allocate, in MB, or None if unknowable.

    Container limit first (cgroup v2, then v1): on Railway the host's free
    memory says nothing about what this container may use. Falls back to
    /proc/meminfo, and returns None on a host that exposes neither (macOS
    development machines) -- an unmeasurable environment reports "unknown"
    and the guard stands down, rather than inventing a number.

    `root` is injectable so the probe is testable against a fixture tree.
    """
    for probe in (_cgroup_v2_available_bytes, _cgroup_v1_available_bytes,
                  _meminfo_available_bytes):
        value = probe(root)
        if value is not None:
            return value / (1024 * 1024)
    return None


class MemoryTooLow(Exception):
    """Not enough memory to start this job safely."""


def require_memory(min_available_mb: float, *, what: str,
                   root: Path = Path("/")) -> float | None:
    """Refuse to start `what` when available memory is under the floor.

    Returns the observed figure (None when unmeasurable) so the caller can
    log it: the floor can only be tuned honestly if every job start records
    what it actually saw.
    """
    observed = available_memory_mb(root=root)
    if min_available_mb <= 0 or observed is None:
        return observed
    if observed < min_available_mb:
        raise MemoryTooLow(
            f"{what} needs {min_available_mb:.0f}MB of headroom; only "
            f"{observed:.0f}MB is available"
        )
    return observed


# ---------------------------------------------------------------- concurrency


class SlotUnavailable(Exception):
    """The job could not get a concurrency slot within its wait budget."""


class ConcurrencySlot:
    """A bounded, blocking admission gate for a kind of background job.

    threading, not asyncio: FastAPI runs synchronous BackgroundTasks in a
    worker thread, so the pipelines this guards are plain blocking code.
    """

    def __init__(self, limit: int, *, wait_s: float, name: str):
        if limit < 1:
            raise ValueError(f"{name} concurrency limit must be >= 1, got {limit}")
        self._semaphore = threading.BoundedSemaphore(limit)
        self._limit = limit
        self._wait_s = wait_s
        self._name = name
        self._lock = threading.Lock()
        self._in_flight = 0

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def in_flight(self) -> int:
        with self._lock:
            return self._in_flight

    @contextmanager
    def acquire(self) -> Iterator[None]:
        if not self._semaphore.acquire(timeout=self._wait_s):
            raise SlotUnavailable(
                f"no {self._name} slot free after {self._wait_s:.0f}s "
                f"(limit {self._limit})"
            )
        with self._lock:
            self._in_flight += 1
        try:
            yield
        finally:
            with self._lock:
                self._in_flight -= 1
            self._semaphore.release()
