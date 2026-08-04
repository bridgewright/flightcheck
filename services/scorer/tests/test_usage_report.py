"""The dated usage report: does it stay honest without anyone remembering to?

A metrics report that reads as customer data when it is self-test data must
not ship. A caveat somebody has to type by hand is a caveat that eventually
is not typed, so every one of these properties is generated from the data
and pinned here.

Pinned by whole line and whole row, not by bare substring. A substring
assertion holds as long as the text is somewhere on the page, so it is also
satisfied by a footnote, or by a different row that happens to contain the
same figure -- both of which passed here through v0.6 while the property
they were supposed to pin had been removed.

No network: fetch_usage is stubbed, and render_report is pure.
"""
from __future__ import annotations

from datetime import date

import pytest
from usage_report import main, render_report, report_path

from scorer.api.usage import UsageMetrics, compute_usage


def _usage(**overrides) -> UsageMetrics:
    base = {
        # Every count is DISTINCT on purpose. When four fields shared the
        # value 5 and two shared 2, a cell could be re-pointed at a sibling
        # field and the row rendered identically, so the whole-row assertions
        # below pinned the text and not its provenance: six such swaps passed
        # green. In production they are not equivalent — sessions_scored
        # excludes `insufficient`, paid_packages_sampled undercounts whenever a
        # package is an unpaid trial (the normal case today), and the
        # scoring-latency sample is smaller than the session sample by design.
        "sample_size": 9,
        "session_completion_rate": 0.8333,
        "p50_first_response_s": None,
        "p50_scoring_latency_s": 142.5,
        "package_burn_through": 4.5,
        "sessions_started": 6,
        "sessions_completed": 5,
        "sessions_scored": 4,
        "packages_sampled": 2,
        "paid_packages_sampled": 1,
        "distinct_users": 3,
        "package_burn_through_ratio": 0.75,
        "p50_candidate_response_s": 1.8,
        "candidate_response_sample": 8,
        "scoring_latency_sample": 7,
        "notes": ["a caveat that came from the payload"],
    }
    base.update(overrides)
    return UsageMetrics(**base)


class TestSampleSizeIsAlwaysStated:
    def test_the_account_count_leads_the_first_line_of_the_summary(self):
        report = render_report(_usage(), generated_on=date(2026, 8, 3),
                               source="https://worker.example")

        summary = ("**Sample: 3 distinct account(s), 2 packages, "
                   "6 started sessions.**")
        assert summary in report, (
            "the whole line is pinned, and in this order: asserting that "
            "'3 distinct account(s)' appears somewhere stays green when the "
            "count is moved off this line into a footnote"
        )
        assert report.index(summary) < report.index("## PRD success"), (
            "the summary comes before the first table, not after it"
        )

    def test_every_rate_prints_its_counts(self):
        report = render_report(_usage(), generated_on=date(2026, 8, 3),
                               source="w")

        # Whole rows. Every sample string below also appears in the summary
        # line or in a neighbouring row, so a bare substring assertion is
        # satisfied from elsewhere in the document with the cell emptied.
        for row in (
            "| Session completion rate | >= 85% | 83.3% | 5/6 sessions |",
            "| Package utilization | >= 4 of 6 | 4.50 sessions | 2 packages |",
            "| Scoring latency (p50) | 142.50s | 7 runs |",
            "| Candidate response latency (p50) | 1.80s | 8 sessions |",
            "| Package burn-through (ratio) | 75.0% of available sessions "
            "| 2 packages |",
            "| Paid packages in sample | 1 | of 2 |",
        ):
            assert row in report, f"rate row lost its sample cell: {row}"


class TestTheSelfTestBanner:
    def test_a_single_account_sample_is_labelled_in_bold_at_the_top(self):
        report = render_report(_usage(distinct_users=1),
                               generated_on=date(2026, 8, 3), source="w")
        assert "not customer usage" in report
        assert report.index("not customer usage") < report.index("PRD success")

    def test_a_zero_account_sample_is_labelled_too(self):
        report = render_report(_usage(distinct_users=0, sessions_started=0),
                               generated_on=date(2026, 8, 3), source="w")
        assert "not customer usage" in report

    def test_a_multi_account_sample_carries_no_banner(self):
        report = render_report(_usage(distinct_users=4),
                               generated_on=date(2026, 8, 3), source="w")
        assert "not customer usage" not in report

    def test_an_empty_product_says_zero_rather_than_unknown(self):
        report = render_report(
            _usage(sessions_started=0, sessions_completed=0,
                   session_completion_rate=0.0, distinct_users=0),
            generated_on=date(2026, 8, 3), source="w")
        assert "No sessions have been started yet" in report


class TestUninstrumentedMetrics:
    def test_the_prd_latency_row_says_not_instrumented(self):
        report = render_report(_usage(), generated_on=date(2026, 8, 3),
                               source="w")
        assert ("| First-response latency (p50) | <= 800 ms | "
                "not instrumented | n/a |") in report

    def test_an_unmeasured_scoring_latency_says_not_measured(self):
        report = render_report(_usage(p50_scoring_latency_s=None,
                                      scoring_latency_sample=0),
                               generated_on=date(2026, 8, 3), source="w")
        assert "not measured" in report

    def test_the_payload_notes_are_reproduced_verbatim(self):
        report = render_report(_usage(notes=["one caveat", "another caveat"]),
                               generated_on=date(2026, 8, 3), source="w")
        assert "- one caveat" in report
        assert "- another caveat" in report

    def test_the_definitions_behind_the_rates_are_written_down(self):
        report = render_report(_usage(), generated_on=date(2026, 8, 3),
                               source="w")
        assert "unused slot, not an abandonment" in report
        assert "keeps its slot" in report


class TestTheFileItWrites:
    def test_the_filename_is_dated(self, tmp_path):
        assert report_path(tmp_path, date(2026, 8, 3)).name == "2026-08-03-usage.md"

    def test_main_writes_the_report_without_touching_the_network(
        self, tmp_path, monkeypatch, capsys
    ):
        monkeypatch.setenv("WORKER_API_TOKEN", "tok")
        monkeypatch.setattr("usage_report.load_env", lambda: None)
        monkeypatch.setattr("usage_report.fetch_usage",
                            lambda url, token: _usage(distinct_users=1))

        exit_code = main(["--worker-url", "https://worker.example",
                          "--out", str(tmp_path), "--date", "2026-08-03"])

        assert exit_code == 0
        written = (tmp_path / "2026-08-03-usage.md").read_text()
        assert "not customer usage" in written
        assert "https://worker.example" in written
        assert "wrote" in capsys.readouterr().out

    def test_main_requires_a_worker_url(self):
        with pytest.raises(SystemExit):
            main(["--out", "/tmp"])


class TestItRendersWhatTheAggregatorProduces:
    def test_a_real_payload_round_trips_into_the_report(self):
        """No hand-built dict: the report renders the aggregator's output."""
        usage = compute_usage([], [])
        report = render_report(usage, generated_on=date(2026, 8, 3), source="w")
        assert "0 started sessions" in report
        assert "not customer usage" in report

    def test_not_instrumented_reaches_the_page_with_its_reason(self):
        """The words and the reason, on one page, from the real payload.

        The row is rendered from a literal and the reason travels in
        `notes`, so nothing but this test holds the two together: emptying
        NOT_INSTRUMENTED_NOTE would print "not instrumented" with no reason
        anywhere in the document.
        """
        report = render_report(compute_usage([], []),
                               generated_on=date(2026, 8, 3), source="w")

        assert ("| First-response latency (p50) | <= 800 ms | "
                "not instrumented | n/a |") in report
        assert "user stops" in report
        assert "not recorded anywhere yet" in report
        assert "p50_candidate_response_s" in report
