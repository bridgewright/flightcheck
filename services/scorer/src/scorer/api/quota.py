"""Pure quota logic for the v0.5 paid-package model (F-24/F-25).

The quota chokepoint reads three facts off a PackageRow: how many sessions
the package exposes right now (ONE until paid -- no unpaid package, trial
or not, ever exposes more, or a second package would be six free sessions),
whether the paid window has expired, and how many slots the existing session
rows have actually consumed. Slot accounting fixes the "Complete pill +
Start session 6" bug: failed/insufficient/planned rows keep their slot per
the F-04/F-17 semantics, so only rows that are being scored, are scored, or
were retired by an attempt cap count as used.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from scorer.api.db import PackageRow, SessionRow

# A session past its attempt caps: the slot is spent and the row is dead --
# never resumed, never re-scored. Deliberately prefixed "failed" so status
# handling that groups failure states reads naturally.
TERMINAL_STATUS = "failed_permanent"

# Rows that keep their paid slot and are handed back by create_session.
RETRIABLE_STATUSES = frozenset({"planned", "failed", "insufficient", "abandoned"})

# Resuming one of these costs an attempt (the row already burned a run);
# resuming a "planned" row is free -- nothing was spent yet. "abandoned"
# counts too (F-66 round-2): re-arming resets the per-attempt mint counter,
# so a free abandoned resume would let reclaim + resume in a loop re-grant
# the mint cap forever -- the durable OpenAI-spend bound migration 005
# exists to hold. A genuine crash's reclaim therefore burns one of the
# resume attempts; the cap, not goodwill, is what bounds every loop.
RESUME_COUNTED_STATUSES = frozenset({"failed", "insufficient", "abandoned"})

# Rows that consume a session slot.
SLOT_CONSUMING_STATUSES = frozenset({"scoring", "scored", TERMINAL_STATUS})


def effective_total_sessions(package: PackageRow) -> int:
    """Sessions the package exposes right now: 1 until it is unlocked.

    Two ways to be unlocked, and they are deliberately different columns.
    paid_at is money. comped_at is access granted without money (migration
    008) -- the operator's own runs, a deliberate free grant. Everything
    downstream of this number treats them identically, because a session is a
    session; everything that counts revenue reads paid_at and must never read
    this function.
    """
    unlocked = package.paid_at is not None or package.comped_at is not None
    return package.total_sessions if unlocked else 1


def is_expired(package: PackageRow, now: datetime | None = None) -> bool:
    """True when the paid window has passed. No expires_at -- never expires
    (trial and unpaid packages have none until payment sets it)."""
    if package.expires_at is None:
        return False
    if now is None:
        now = datetime.now(UTC)
    return datetime.fromisoformat(package.expires_at) < now


def sessions_used(rows: Iterable[SessionRow]) -> int:
    """Slots actually consumed by these session rows."""
    return sum(1 for row in rows if row.status in SLOT_CONSUMING_STATUSES)
