"""Stuck-state reaper (F-31 minimum): no row is stuck forever.

A container death mid-job leaves "compiling" packages and "scoring"
sessions in-flight with nobody to finish them. Every live job now touches
updated_at as it progresses, so a row whose clock is older than the config
threshold has no worker behind it: the reaper flips it to "failed" --
retryable through compile-retry / session resume -- and refreshes the clock
so it is never double-reaped. Rows with a NULL updated_at predate the
lifecycle batch and are left alone (the listing contract excludes them).

Wiring lives in app.py's lifespan: one pass at startup (rows orphaned by
the PREVIOUS container die immediately, not half an hour into the new one)
plus a periodic asyncio task at the config cadence.
"""
from __future__ import annotations

import logging

from scorer.api.db import Database

logger = logging.getLogger(__name__)


def reap_stuck(db: Database, *, stale_after_s: float) -> dict[str, list[str]]:
    """One reap pass; returns the flipped row ids per table."""
    reaped: dict[str, list[str]] = {"packages": [], "sessions": []}
    for package in db.list_stale_packages("compiling", stale_after_s):
        db.set_package_rubric(package.id, None, "failed")
        db.touch_updated_at("package", package.id)
        reaped["packages"].append(package.id)
    for session in db.list_stale_sessions("scoring", stale_after_s):
        db.set_session_status(session.id, "failed")
        db.touch_updated_at("session", session.id)
        reaped["sessions"].append(session.id)
    if reaped["packages"] or reaped["sessions"]:
        logger.warning(
            "reaped stuck rows: packages=%s sessions=%s",
            reaped["packages"], reaped["sessions"],
        )
    return reaped


def reap_stuck_safely(db: Database, *,
                      stale_after_s: float) -> dict[str, list[str]] | None:
    """reap_stuck that can never kill its caller; None on failure.

    The reaper runs unattended inside the worker's lifespan -- a database
    hiccup must cost one missed pass, never the periodic task.
    """
    try:
        return reap_stuck(db, stale_after_s=stale_after_s)
    except Exception:
        logger.exception("reaper pass failed; will retry next interval")
        return None
