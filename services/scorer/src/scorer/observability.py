"""Worker observability: stdout logging config and guarded Sentry init.

The scorer logged through module loggers from day one, but nothing ever
configured logging, so every INFO line (the F-04 eligibility gate, reaper
passes, payment provisioning) was silently dropped in production. Railway
captures stdout; dictConfig points the root logger there at INFO.

Sentry is opt-in by environment: a set SENTRY_DSN initializes the SDK, an
unset one is a clean no-op -- no warning spam, no import cost. PII stays
off (send_default_pii=False): events carry ids and tracebacks, never
candidate text or tokens.
"""
from __future__ import annotations

import logging.config
import os


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
                "format": "%(asctime)s %(levelname)s %(name)s: %(message)s",
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
