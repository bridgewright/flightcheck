"""Worker observability: structured stdout logging, guarded Sentry init, and
the health check /healthz answers with.

The scorer logged through module loggers from day one, but nothing ever
configured logging, so every INFO line (the F-04 eligibility gate, reaper
passes, payment provisioning) was silently dropped in production. Railway
captures stdout; dictConfig points the root logger there at INFO.

Sentry is opt-in by environment: a set SENTRY_DSN initializes the SDK, an
unset one is a clean no-op -- no warning spam, no import cost. PII stays
off (send_default_pii=False): events carry ids and tracebacks, never
candidate text or tokens.

v0.6 (F-36) adds the two halves that make a production incident diagnosable:

* Every line carries the request id bound by api/requestid.py, so a Railway
  traceback names the Vercel request that caused it.
* run_health_checks turns /healthz from an unconditional "ok" into a
  statement about dependencies the worker actually needs. The old endpoint
  returned true whatever the state of the process, which is how a dead
  Railway build kept serving traffic while every new deploy failed.
"""
from __future__ import annotations

import logging.config
import os
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Lock
from typing import Protocol

# What a line shows when there is no request in scope: startup, the reaper
# loop, a tools/ script. Must equal api.requestid.NO_REQUEST_ID -- kept as a
# literal so this module stays importable without the HTTP stack, and gated
# by a test that imports both.
NO_REQUEST_ID_FALLBACK = "-"

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s [req=%(request_id)s]: %(message)s"


class RequestIdFormatter(logging.Formatter):
    """Formats LOG_FORMAT, defaulting request_id when a record lacks it.

    api/requestid.py installs a record factory that gives every record the
    attribute, but records are created before create_app ever runs -- during
    imports, in tools/ scripts, inside libraries. A formatter that assumed
    the field would raise inside logging and drop those lines entirely,
    which is the opposite of the point.
    """

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = NO_REQUEST_ID_FALLBACK
        return super().format(record)


def setup_logging() -> None:
    """Route INFO+ from every logger to stdout (what Railway captures).

    dictConfig REPLACES the root configuration, so calling this twice never
    stacks handlers; existing loggers keep working
    (disable_existing_loggers=False).
    """
    logging.config.dictConfig({
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "app": {
                "()": f"{__name__}.RequestIdFormatter",
                "format": LOG_FORMAT,
            },
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "app",
            },
        },
        "root": {"level": "INFO", "handlers": ["stdout"]},
    })


def init_sentry() -> bool:
    """Initialize Sentry when SENTRY_DSN is set; True when it was.

    Deliberately quiet when unset: local runs and tests must not warn on
    every startup about a service they never asked for.
    """
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(dsn=dsn, send_default_pii=False)
    return True


# --- health -----------------------------------------------------------------
#
# What /healthz checks, and what it deliberately does not.
#
# CHECKS the database. It is the only dependency the worker cannot serve a
# single request without, and a build that cannot reach it must never be
# promoted over one that can -- that is the whole job of a platform health
# check.
#
# DOES NOT check Gemini, OpenAI, or object storage. They are slow, remote,
# rate-limited, and cost money per call. A provider having a bad minute is
# not a reason to fail a deployment or to take this worker out of rotation;
# the pipeline's own retries and the dead-letter path are where that belongs.
# A health check that fans out to every dependency turns any one of them into
# a total outage, which is a worse failure than the one it detects.
#
# Every probe runs under a hard timeout, because the second way a health
# check lies is by never answering at all.

HEALTH_PROBE_TIMEOUT_S = 2.0

# Bounded on purpose: a probe that hangs holds its worker until the process
# ends, so the pool caps how many can ever be stuck. Once it is saturated,
# further probes are still submitted, still time out, and still report
# honestly -- they simply never spawn another thread.
_HEALTH_POOL_SIZE = 2

_health_executor: ThreadPoolExecutor | None = None
_health_executor_lock = Lock()


def _executor() -> ThreadPoolExecutor:
    global _health_executor
    with _health_executor_lock:
        if _health_executor is None:
            _health_executor = ThreadPoolExecutor(
                max_workers=_HEALTH_POOL_SIZE, thread_name_prefix="healthz"
            )
        return _health_executor


@dataclass(frozen=True)
class HealthReport:
    """The answer /healthz serves. ok is false if any check is not ok."""

    ok: bool
    checks: tuple[tuple[str, str], ...]
    release: str | None

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "checks": dict(self.checks),
            "release": self.release,
        }


def _release() -> str | None:
    """Which build is answering, when the platform says.

    The incident this exists for: a dead Railway build kept serving while
    every new deploy failed, and nothing in the response distinguished them.
    """
    for key in ("RAILWAY_GIT_COMMIT_SHA", "RAILWAY_DEPLOYMENT_ID"):
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return None


def run_health_checks(
    probes: Mapping[str, Callable[[], object]],
    *,
    timeout_s: float = HEALTH_PROBE_TIMEOUT_S,
) -> HealthReport:
    """Run each probe under a deadline and report what actually happened.

    A probe passes by returning; it fails by raising or by not finishing in
    time. Failure details carry the exception TYPE only -- /healthz is public
    and unauthenticated, and database errors quote hosts, DSNs, and
    occasionally credentials.
    """
    results: list[tuple[str, str]] = []
    futures = {name: _executor().submit(probe) for name, probe in probes.items()}
    for name, future in futures.items():
        try:
            future.result(timeout=timeout_s)
            results.append((name, "ok"))
        except TimeoutError:
            # concurrent.futures.TimeoutError is builtins.TimeoutError on
            # 3.11+. The probe keeps running; we simply stop waiting.
            results.append((name, "timeout"))
        except Exception as error:  # noqa: BLE001 -- the type is the report
            results.append((name, f"error: {type(error).__name__}"))
    return HealthReport(
        ok=all(detail == "ok" for _, detail in results),
        checks=tuple(results),
        release=_release(),
    )


class _TokenLookup(Protocol):
    """The one Database method the probe needs, structurally."""

    def get_package_by_token(self, access_token: str) -> object: ...


# A token no package can hold: the column is generated by secrets.token_urlsafe.
_UNREACHABLE_TOKEN = "healthz-probe-not-a-real-token"


def database_probe(db: _TokenLookup) -> Callable[[], None]:
    """A probe that proves the database answers, without depending on data.

    A lookup for a token that cannot exist is the cheapest complete round
    trip available: it is indexed, it reads nothing real, it writes nothing,
    and "no such package" is a successful answer. Anything other than that
    KeyError -- a refused connection, a timeout, an auth failure -- is the
    unreachability worth reporting, and propagates.
    """

    def probe() -> None:
        try:
            db.get_package_by_token(_UNREACHABLE_TOKEN)
        except KeyError:
            return

    return probe
