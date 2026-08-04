"""Comped access and package deletion (F-53).

Two things are being kept apart on purpose and the tests say so: a comp
unlocks sessions and is not a payment, and deleting a package removes what
the customer made but not the record that money moved.
"""
from __future__ import annotations

import pytest

from scorer.api.comp import comped_account_ids, is_comped_account
from scorer.api.db import PackageRow
from scorer.api.deletion import collect_package_deletion_plan
from scorer.api.quota import effective_total_sessions

from fakes import FakeDatabase


def _package(**overrides) -> PackageRow:
    base = dict(
        id="pkg-1", access_token="tok", status="ready", jd_text="jd",
        candidate_profile=None, rubric=None, user_id="user-1",
        total_sessions=6,
    )
    base.update(overrides)
    return PackageRow(**base)


class TestAllowlist:
    def test_unset_grants_nothing(self):
        assert comped_account_ids("") == frozenset()
        assert not is_comped_account("user-1", "")

    def test_ids_are_matched_exactly_after_trimming(self):
        raw = " user-1 , user-2,, "
        assert comped_account_ids(raw) == frozenset({"user-1", "user-2"})
        assert is_comped_account("user-2", raw)
        assert not is_comped_account("user-3", raw)

    def test_an_anonymous_package_is_never_comped(self):
        # A token-only package with six sessions would be six free sessions
        # for whoever holds the link.
        assert not is_comped_account(None, "user-1")

    def test_no_wildcard_is_honoured(self):
        # If someone writes "*" expecting it to work, it must grant nothing
        # rather than everything.
        assert not is_comped_account("user-1", "*")


class TestQuota:
    def test_a_locked_package_still_exposes_one_session(self):
        assert effective_total_sessions(_package()) == 1

    def test_a_comped_package_exposes_its_full_count(self):
        assert effective_total_sessions(_package(comped_at="2026-08-04T00:00:00+00:00")) == 6

    def test_a_comp_is_not_a_payment(self):
        # The distinction this whole feature rests on: unlocked for sessions,
        # invisible to anything that counts money.
        package = _package(comped_at="2026-08-04T00:00:00+00:00")
        assert package.paid_at is None
        assert package.order_id is None
        assert package.expires_at is None


class TestPackageDeletionPlan:
    def test_it_covers_the_package_and_leaves_orders_alone(self):
        db = FakeDatabase()
        package = db.create_package("jd", None, user_id="user-1")
        session = db.create_session(package.id, 1, None)
        db.set_session_status(session.id, "scored",
                              audio_path=f"{package.id}/1.webm")

        plan = collect_package_deletion_plan(db, "user-1", package.id)

        assert plan.package_ids == [package.id]
        assert plan.session_ids == [session.id]
        assert plan.order_ids == [], "a receipt outlives the thing it paid for"
        assert f"{package.id}/1.webm" in plan.storage_keys

    def test_another_account_cannot_plan_a_deletion(self):
        db = FakeDatabase()
        package = db.create_package("jd", None, user_id="user-1")
        with pytest.raises(PermissionError):
            collect_package_deletion_plan(db, "user-2", package.id)

    def test_an_unclaimed_package_belongs_to_nobody(self):
        db = FakeDatabase()
        package = db.create_package("jd", None, user_id=None)
        with pytest.raises(PermissionError):
            collect_package_deletion_plan(db, "user-1", package.id)
