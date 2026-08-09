"""Tests for scorer.api.quota -- pure paid-package quota logic (v0.5)."""
from datetime import UTC, datetime

from fakes import FakeDatabase
from scorer.api.quota import (
    RESUME_COUNTED_STATUSES,
    RETRIABLE_STATUSES,
    SLOT_CONSUMING_STATUSES,
    TERMINAL_STATUS,
    effective_total_sessions,
    is_expired,
    sessions_used,
)


def _package(**update):
    db = FakeDatabase()
    row = db.create_package("jd", None, user_id="user-1")
    return row.model_copy(update=update) if update else row


def test_status_sets_partition_the_session_vocabulary():
    # Retriable rows keep their slot; slot-consuming rows spend it. No status
    # may be both, and the terminal status must consume (that is the point).
    assert not (SLOT_CONSUMING_STATUSES & RETRIABLE_STATUSES)
    assert TERMINAL_STATUS in SLOT_CONSUMING_STATUSES
    # "abandoned" counts since F-66 round-2: re-arming resets the mint
    # counter, so only planned resumes stay free.
    assert RESUME_COUNTED_STATUSES == {"failed", "insufficient", "abandoned"}
    assert "planned" in RETRIABLE_STATUSES


def test_locked_standard_package_exposes_no_sessions():
    assert effective_total_sessions(_package(total_sessions=6)) == 0


def test_paid_standard_package_exposes_its_total():
    paid = _package(paid_at="2026-08-03T00:00:00+00:00", total_sessions=6)
    assert effective_total_sessions(paid) == 6


def test_comped_standard_package_exposes_its_total():
    comped = _package(comped_at="2026-08-03T00:00:00+00:00", total_sessions=6)
    assert effective_total_sessions(comped) == 6


def test_quick_package_exposes_exactly_one_session_for_its_lifetime():
    quick = _package(kind="quick", total_sessions=99)
    assert effective_total_sessions(quick) == 1


def test_is_expired_only_when_expires_at_has_passed():
    now = datetime(2026, 9, 3, 12, 0, 0, tzinfo=UTC)
    no_expiry = _package()
    assert is_expired(no_expiry, now=now) is False   # trial: never expires
    live = _package(expires_at="2026-09-04T00:00:00+00:00")
    assert is_expired(live, now=now) is False
    expired = _package(expires_at="2026-09-03T11:59:59+00:00")
    assert is_expired(expired, now=now) is True


def test_is_expired_boundary_instant_is_not_expired():
    now = datetime(2026, 9, 3, 12, 0, 0, tzinfo=UTC)
    at_boundary = _package(expires_at="2026-09-03T12:00:00+00:00")
    assert is_expired(at_boundary, now=now) is False


def test_sessions_used_counts_slot_consuming_statuses_only():
    # The "Complete pill + Start session 6" bug: a failed or insufficient row
    # keeps its slot, so it must not count as used anywhere.
    db = FakeDatabase()
    package = db.create_package("jd", None, user_id="user-1")
    statuses = ["scored", "scoring", "quick_done", "failed", "insufficient",
                "planned", TERMINAL_STATUS]
    for index, status in enumerate(statuses, start=1):
        row = db.create_session(package.id, index, None)
        db.sessions[row.id] = row.model_copy(update={"status": status})
    assert sessions_used(db.list_sessions(package.id)) == 4
