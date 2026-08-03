"""F-13 real-usage metrics: the three PRD targets, made measurable.

PRD.md carries three numeric success metrics and, until now, no way to read
any of them without querying the database by hand. This module aggregates
them from columns that already exist -- no migration, no new write path.

The hard part of this feature is not the arithmetic, it is honesty. The
repo has a standing rule that a metrics report states its sample size and
says plainly when the sample is the operator rather than customers, and
impression rule (7) fails a release whose numbers read like customer data
when they are self-test data. So:

* every rate ships next to the counts it came from;
* `distinct_users` is reported, because "N=1 account" is the single most
  important thing about every number this product can currently produce;
* a metric the product does not actually instrument is `None` with a note
  saying so, never a plausible-looking substitute.

That last point costs us one of the three PRD metrics today.
`p50_first_response_s` in the PRD is "user stops -> interviewer speaks",
and the source it names, `DeliveryMetrics.avg_response_latency_s`, measures
the opposite direction: interviewer segment end -> candidate segment start,
which is how fast the CANDIDATE answers. That is a real and useful number,
so it is reported under its own name; the PRD's metric stays None until the
room instruments it, because publishing the candidate's latency as the
product's response latency would be a number that is simply not true.
"""
from __future__ import annotations

import threading
from collections import deque
from statistics import median

from pydantic import BaseModel, ConfigDict

from scorer.api.db import PackageRow, SessionRow
from scorer.api.quota import (
    TERMINAL_STATUS,
    effective_total_sessions,
    sessions_used,
)
from scorer.resilience import load_resilience_config

# A session that left the waiting room: either the pipeline has seen it, or
# the browser connected to the interviewer at least once. A "planned" row
# nobody ever entered is not an abandoned session, it is an unused slot.
_STARTED_STATUSES = frozenset(
    {"scoring", "scored", "failed", "insufficient", TERMINAL_STATUS})

# PRD.md: "session completion rate (no mid-session abandonment)", sourced
# from "scored+insufficient vs started". An insufficient session ran to the
# end and uploaded; the recording was simply too short to score.
_COMPLETED_STATUSES = frozenset({"scored", "insufficient"})

NOT_INSTRUMENTED_NOTE = (
    "p50_first_response_s is not reported: the PRD defines it as "
    "\"user stops -> interviewer speaks\", which is measured in the browser "
    "and is not recorded anywhere yet. The stored per-session figure "
    "measures the opposite direction (how fast the candidate answers) and "
    "is reported separately as p50_candidate_response_s."
)
SELF_TEST_NOTE = (
    "This sample comes from a single account. These are self-test numbers, "
    "not customer usage."
)
NO_DATA_NOTE = "No sessions have been started yet; every rate below is zero."
PROCESS_LOCAL_NOTE = (
    "p50_scoring_latency_s is measured in this worker process and resets "
    "when it restarts, so its sample is smaller than the session sample."
)


class UsageMetrics(BaseModel):
    """The usage payload. Mirrors apps/web/lib/types.ts UsageMetrics, which
    carries the first five fields; the rest are the provenance the honesty
    rule requires, and the web is free to ignore them."""

    model_config = ConfigDict(extra="forbid")

    sample_size: int                       # sessions considered
    session_completion_rate: float         # (scored + insufficient) / started
    p50_first_response_s: float | None     # see NOT_INSTRUMENTED_NOTE
    p50_scoring_latency_s: float | None
    package_burn_through: float            # mean sessions used per package

    sessions_started: int
    sessions_completed: int
    sessions_scored: int
    packages_sampled: int
    paid_packages_sampled: int
    distinct_users: int
    package_burn_through_ratio: float      # mean used / available
    p50_candidate_response_s: float | None
    candidate_response_sample: int
    scoring_latency_sample: int
    notes: list[str]


class LatencySampler:
    """Bounded, thread-safe ring of observed durations.

    Process-local by construction, and labelled as such wherever its number
    is published: there is no column for a scoring run's duration, and this
    batch deliberately adds no migration. A number that resets on restart
    and says so is worth more than no number; a number that resets on
    restart and pretends otherwise is worth less than none.
    """

    def __init__(self, max_samples: int):
        self._samples: deque[float] = deque(maxlen=max_samples)
        self._lock = threading.Lock()

    def record(self, seconds: float) -> None:
        with self._lock:
            self._samples.append(seconds)

    def p50(self) -> float | None:
        with self._lock:
            samples = list(self._samples)
        return round(median(samples), 2) if samples else None

    @property
    def sample_size(self) -> int:
        with self._lock:
            return len(self._samples)


_scoring_latency: LatencySampler | None = None
_scoring_latency_lock = threading.Lock()


def scoring_latency() -> LatencySampler:
    """The process-wide scoring-duration sampler."""
    global _scoring_latency
    with _scoring_latency_lock:
        if _scoring_latency is None:
            _scoring_latency = LatencySampler(
                load_resilience_config().metrics.scoring_latency_samples)
        return _scoring_latency


def reset_scoring_latency() -> None:
    """Drop the sampler (tests only; nothing in production calls it)."""
    global _scoring_latency
    with _scoring_latency_lock:
        _scoring_latency = None


def _has_started(row: SessionRow) -> bool:
    return row.status in _STARTED_STATUSES or row.secret_mints > 0


def _candidate_latencies(sessions: list[SessionRow]) -> list[float]:
    return [
        row.report.delivery_metrics.avg_response_latency_s
        for row in sessions
        if row.report is not None
        and row.report.delivery_metrics.avg_response_latency_s is not None
    ]


def compute_usage(packages: list[PackageRow],
                  sessions: list[SessionRow]) -> UsageMetrics:
    """Aggregate the usage payload from rows the caller has already read.

    Pure: it takes rows, not a Database, so every definition below is
    testable without a backend and the same function serves the endpoint
    and the report tool.
    """
    started = [row for row in sessions if _has_started(row)]
    completed = [row for row in started if row.status in _COMPLETED_STATUSES]
    scored = [row for row in started if row.status == "scored"]

    by_package: dict[str, list[SessionRow]] = {}
    for row in sessions:
        by_package.setdefault(row.package_id, []).append(row)
    used_counts = [
        sessions_used(by_package.get(package.id, [])) for package in packages
    ]
    available = [effective_total_sessions(package) for package in packages]
    burn_through = (sum(used_counts) / len(used_counts)) if used_counts else 0.0
    burn_ratio = (
        sum(used / total for used, total in zip(used_counts, available, strict=True)
            if total) / len(used_counts)
        if used_counts else 0.0
    )

    latencies = _candidate_latencies(sessions)
    sampler = scoring_latency()
    distinct_users = len({
        package.user_id for package in packages if package.user_id is not None
    })

    notes = [NOT_INSTRUMENTED_NOTE]
    if not started:
        notes.append(NO_DATA_NOTE)
    if distinct_users <= 1:
        notes.append(SELF_TEST_NOTE)
    if sampler.sample_size < len(scored):
        notes.append(PROCESS_LOCAL_NOTE)

    return UsageMetrics(
        sample_size=len(started),
        session_completion_rate=(
            round(len(completed) / len(started), 4) if started else 0.0),
        p50_first_response_s=None,
        p50_scoring_latency_s=sampler.p50(),
        package_burn_through=round(burn_through, 2),
        sessions_started=len(started),
        sessions_completed=len(completed),
        sessions_scored=len(scored),
        packages_sampled=len(packages),
        paid_packages_sampled=sum(
            1 for package in packages if package.paid_at is not None),
        distinct_users=distinct_users,
        package_burn_through_ratio=round(burn_ratio, 4),
        p50_candidate_response_s=(
            round(median(latencies), 2) if latencies else None),
        candidate_response_sample=len(latencies),
        scoring_latency_sample=sampler.sample_size,
        notes=notes,
    )
