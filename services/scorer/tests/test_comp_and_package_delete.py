"""Comped access and package deletion (F-53).

Two things are being kept apart on purpose and the tests say so: a comp
unlocks sessions and is not a payment, and deleting a package removes what
the customer made but not the record that money moved.
"""
from __future__ import annotations

import pytest

from fakes import FakeDatabase
from scorer.api.comp import comped_account_ids, is_comped_account
from scorer.api.db import PackageRow
from scorer.api.deletion import collect_package_deletion_plan
from scorer.api.quota import effective_total_sessions


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


class TestTheConverterKeepsEveryColumn:
    """The read path that silently dropped comped access.

    _to_package_row names its fields, so a column can exist in the table, in
    the model, and in the write, and still arrive as None on every read. No
    test caught it because every test built rows in Python rather than
    through the converter. This one walks the model instead of a list
    somebody has to remember to extend.
    """

    def test_every_model_field_is_read_from_the_row_dict(self):
        from scorer.api.db import PackageRow, _to_package_row

        row = {
            "id": "pkg-1", "access_token": "tok", "status": "ready",
            "jd_text": "jd", "jd_url": "https://example.com/jobs/1",
            "candidate_profile": None, "rubric": None,
            "user_id": "user-1", "total_sessions": 6, "is_trial": False,
            "kind": "standard", "quick_company": None, "quick_role": None,
            "paid_at": "2026-08-01T00:00:00+00:00",
            "comped_at": "2026-08-04T00:00:00+00:00",
            "expires_at": "2026-08-31T00:00:00+00:00",
            "order_id": "ord-1", "updated_at": "2026-08-04T00:00:00+00:00",
        }
        converted = _to_package_row(row)
        for name in PackageRow.model_fields:
            assert getattr(converted, name) == row[name], (
                f"_to_package_row drops {name}: it is in the model and in the "
                "row dict, and the converter does not copy it"
            )


class TestRubricReuseCannotBreakCreation:
    """The lookup that took a package down with it.

    Observed in production 2026-08-04: a JD fetched from a careers page ran
    to tens of kilobytes, the equality filter put all of it in a URI,
    PostgREST answered 400, and create_package raised AFTER inserting the
    row. The customer got a package that said Compiling forever.

    Reuse is an optimization. A miss costs one compile; a raise costs the
    whole request.
    """

    def test_a_long_jd_skips_the_lookup_instead_of_risking_the_uri(self):
        from scorer.api.db import _REUSE_LOOKUP_MAX_CHARS

        # A budget for a URI, not a product rule, so it only has to be big
        # enough for real repeat pastes and small enough for a server.
        assert 1_000 <= _REUSE_LOOKUP_MAX_CHARS <= 12_000

    def test_the_source_treats_a_failed_lookup_as_a_miss(self):
        from pathlib import Path

        import scorer.api.db as db_module

        source = Path(db_module.__file__).read_text()
        # [-1], not [1]: the name appears twice, on the Protocol stub and on
        # the implementation, and only the second one has a body.
        body = source.split("def find_ready_rubric_by_jd")[-1].split("\n    def ")[0]
        assert "_REUSE_LOOKUP_MAX_CHARS" in body
        assert "except PostgrestAPIError" in body
        assert body.count("return None") >= 3
