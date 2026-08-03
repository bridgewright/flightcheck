"""F-13: the usage aggregation and the endpoint that serves it.

Two things are under test. The arithmetic -- which definition of "started",
which of "completed", how burn-through is averaged -- and the honesty, which
matters more: impression rule (7) fails a release whose metrics read like
customer data when they are the operator's own self-test runs.
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from factories import make_rubric
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.db import PackageRow, SessionRow
from scorer.api.usage import (
    NOT_INSTRUMENTED_NOTE,
    SELF_TEST_NOTE,
    LatencySampler,
    compute_usage,
    reset_scoring_latency,
    scoring_latency,
)
from scorer.schemas import (
    DeliveryMetrics,
    DimensionScore,
    SessionReport,
)

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture(autouse=True)
def _fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))
    reset_scoring_latency()
    yield
    reset_scoring_latency()


def _package(index: int, *, user: str | None = "user-1", paid: bool = True,
             total: int = 6) -> PackageRow:
    return PackageRow(
        id=f"pkg-{index}", access_token=f"tok-{index}", status="ready",
        jd_text="jd", candidate_profile=None, rubric=None, user_id=user,
        total_sessions=total,
        paid_at=datetime.now(UTC).isoformat() if paid else None,
    )


def _report(latency: float | None) -> SessionReport:
    return SessionReport(
        session_id="sess", verdict="approaching", overall_score=3.5,
        dimension_scores=[DimensionScore(
            dimension_key="structured-answers", score=3.5,
            evidence_quotes=[], rationale="x")],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=120.0, wpm_timeline=[120.0], silence_events=[],
            filler_count=1, filler_rate_per_min=1.0, f0_variance=None,
            avg_response_latency_s=latency),
        delivery_observations=[], strengths=[], gaps=[], next_drills=[],
        limits_note="",
    )


def _session(index: int, package_id: str, status: str, *, mints: int = 1,
             latency: float | None = None) -> SessionRow:
    return SessionRow(
        id=f"sess-{index}", package_id=package_id, index=index, status=status,
        session_plan=None, audio_path=None,
        report=_report(latency) if latency is not None else None,
        secret_mints=mints,
    )


class TestCompletionRate:
    def test_the_prd_definition_is_scored_plus_insufficient_over_started(self):
        package = _package(1)
        sessions = [
            _session(1, "pkg-1", "scored"),
            _session(2, "pkg-1", "insufficient"),
            _session(3, "pkg-1", "failed"),
            _session(4, "pkg-1", "scoring"),
        ]

        usage = compute_usage([package], sessions)

        assert usage.sessions_started == 4
        assert usage.sessions_completed == 2
        assert usage.session_completion_rate == 0.5

    def test_a_planned_row_nobody_entered_is_not_an_abandoned_session(self):
        package = _package(1)
        sessions = [
            _session(1, "pkg-1", "scored"),
            _session(2, "pkg-1", "planned", mints=0),
        ]

        usage = compute_usage([package], sessions)

        assert usage.sessions_started == 1, (
            "an unused slot is not a session somebody walked out of"
        )
        assert usage.session_completion_rate == 1.0

    def test_a_planned_row_someone_entered_counts_as_started(self):
        usage = compute_usage([_package(1)],
                              [_session(1, "pkg-1", "planned", mints=2)])
        assert usage.sessions_started == 1
        assert usage.session_completion_rate == 0.0

    def test_an_empty_product_reports_zero_not_a_crash(self):
        usage = compute_usage([], [])
        assert usage.sample_size == 0
        assert usage.session_completion_rate == 0.0
        assert usage.package_burn_through == 0.0


class TestBurnThrough:
    def test_it_is_the_mean_slots_consumed_per_package(self):
        packages = [_package(1), _package(2)]
        sessions = [
            _session(1, "pkg-1", "scored"),
            _session(2, "pkg-1", "scored"),
            _session(3, "pkg-1", "scored"),
            _session(4, "pkg-2", "scored"),
        ]

        usage = compute_usage(packages, sessions)

        assert usage.package_burn_through == 2.0, (
            "the PRD target is 'sessions actually used, of 6', so the "
            "headline number is a count, not a fraction"
        )
        assert usage.package_burn_through_ratio == pytest.approx(2 / 6, abs=1e-4)

    def test_an_unpaid_package_is_measured_against_its_one_session(self):
        packages = [_package(1, paid=False)]
        sessions = [_session(1, "pkg-1", "scored")]

        usage = compute_usage(packages, sessions)

        assert usage.package_burn_through_ratio == 1.0
        assert usage.paid_packages_sampled == 0

    def test_failed_rows_keep_their_slot_and_do_not_count_as_used(self):
        usage = compute_usage([_package(1)],
                              [_session(1, "pkg-1", "failed")])
        assert usage.package_burn_through == 0.0


class TestHonesty:
    def test_the_prd_first_response_metric_is_none_with_a_reason(self):
        usage = compute_usage([_package(1)],
                              [_session(1, "pkg-1", "scored", latency=1.4)])

        assert usage.p50_first_response_s is None
        assert NOT_INSTRUMENTED_NOTE in usage.notes

    def test_the_candidate_latency_we_do_have_is_reported_under_its_own_name(self):
        sessions = [
            _session(1, "pkg-1", "scored", latency=1.0),
            _session(2, "pkg-1", "scored", latency=3.0),
            _session(3, "pkg-1", "scored", latency=2.0),
        ]

        usage = compute_usage([_package(1)], sessions)

        assert usage.p50_candidate_response_s == 2.0
        assert usage.candidate_response_sample == 3

    def test_a_single_account_sample_says_so_in_plain_words(self):
        usage = compute_usage([_package(1, user="user-1")],
                              [_session(1, "pkg-1", "scored")])
        assert SELF_TEST_NOTE in usage.notes
        assert usage.distinct_users == 1

    def test_a_multi_account_sample_drops_the_self_test_note(self):
        packages = [_package(1, user="user-1"), _package(2, user="user-2")]
        sessions = [_session(1, "pkg-1", "scored"), _session(2, "pkg-2", "scored")]

        usage = compute_usage(packages, sessions)

        assert SELF_TEST_NOTE not in usage.notes
        assert usage.distinct_users == 2

    def test_every_rate_ships_with_the_counts_behind_it(self):
        usage = compute_usage([_package(1)], [_session(1, "pkg-1", "scored")])
        assert usage.sample_size == usage.sessions_started
        assert usage.packages_sampled == 1
        assert usage.sessions_scored == 1


class TestScoringLatency:
    def test_the_p50_comes_from_the_process_sampler(self):
        scoring_latency().record(10.0)
        scoring_latency().record(30.0)
        scoring_latency().record(20.0)

        usage = compute_usage([], [])

        assert usage.p50_scoring_latency_s == 20.0
        assert usage.scoring_latency_sample == 3

    def test_an_unmeasured_worker_reports_none_not_zero(self):
        usage = compute_usage([], [])
        assert usage.p50_scoring_latency_s is None
        assert usage.scoring_latency_sample == 0

    def test_the_sampler_is_bounded(self):
        sampler = LatencySampler(max_samples=3)
        for value in (1.0, 2.0, 3.0, 4.0, 5.0):
            sampler.record(value)
        assert sampler.sample_size == 3
        assert sampler.p50() == 4.0


class TestTheEndpoint:
    def test_it_serves_the_aggregate_over_bounded_reads(self):
        db = FakeDatabase()
        package = db.create_package("jd", None, user_id="user-1")
        db.set_package_rubric(package.id, make_rubric(), "ready")
        row = db.create_session(package.id, 1, None)
        db.set_session_status(row.id, "scored")
        client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))

        response = client.get("/api/metrics/usage", headers=AUTH)

        assert response.status_code == 200
        body = response.json()
        assert body["sample_size"] == 1
        assert body["packages_sampled"] == 1
        assert body["p50_first_response_s"] is None
        assert any("self-test" in note for note in body["notes"])

    def test_the_reads_are_bounded_by_config(self, monkeypatch):
        db = FakeDatabase()
        seen: dict[str, int] = {}
        real = db.list_recent_sessions

        def spy(limit: int):
            seen["limit"] = limit
            return real(limit)

        monkeypatch.setattr(db, "list_recent_sessions", spy)
        client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))

        client.get("/api/metrics/usage", headers=AUTH)

        from scorer.resilience import load_resilience_config
        assert seen["limit"] == load_resilience_config().metrics.usage_scan_limit

    def test_it_is_behind_the_worker_token(self):
        client = TestClient(create_app(FakeDatabase(), FakeStorage(), FakeGenAI([])))
        assert client.get("/api/metrics/usage").status_code == 401
