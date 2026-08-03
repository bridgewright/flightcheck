"""F-36: structured logs carry the request id, and healthz tells the truth."""
from __future__ import annotations

import logging
import time

import pytest

from fakes import FakeDatabase
from scorer.api.requestid import NO_REQUEST_ID, bind_request_id_to_log_records
from scorer.observability import (
    HEALTH_PROBE_TIMEOUT_S,
    LOG_FORMAT,
    NO_REQUEST_ID_FALLBACK,
    HealthReport,
    RequestIdFormatter,
    database_probe,
    run_health_checks,
    setup_logging,
)

# --- structured logs ------------------------------------------------------


def test_the_log_format_carries_the_request_id():
    # The whole point of the Phase 0 plumbing: a Railway line must name the
    # web request that caused it. If the id is not in the format, the id is
    # not in the logs.
    assert "%(request_id)s" in LOG_FORMAT


def test_setup_logging_installs_a_formatter_that_never_raises_on_a_bare_record():
    # Records are created all over: tools/ scripts, imports at startup, a
    # library's own logger -- long before create_app installs the record
    # factory. A formatter referencing a field those records lack would
    # raise inside logging and lose the line entirely.
    setup_logging()
    record = logging.LogRecord(
        "scorer.tools.thing", logging.INFO, __file__, 1, "hello", None, None
    )
    assert not hasattr(record, "request_id")
    formatter = RequestIdFormatter(LOG_FORMAT)
    line = formatter.format(record)
    assert "hello" in line
    assert NO_REQUEST_ID_FALLBACK in line


def test_a_bound_request_id_reaches_the_formatted_line():
    bind_request_id_to_log_records()
    formatter = RequestIdFormatter(LOG_FORMAT)
    # Through the factory, which is the path every real log call takes
    # (Logger.makeRecord). Constructing LogRecord directly bypasses it --
    # that case is the fallback test above.
    record = logging.getLogRecordFactory()(
        "scorer.api.pipeline", logging.INFO, __file__, 1, "scoring", None, None
    )
    # Outside a request the factory sets the sentinel, not a fake id.
    assert record.request_id == NO_REQUEST_ID
    record.request_id = "abc-123"
    assert "abc-123" in formatter.format(record)


def test_the_fallback_matches_the_middleware_sentinel():
    # Two modules, one convention. A drift here would put two different
    # "no request" markers in the same log stream.
    assert NO_REQUEST_ID_FALLBACK == NO_REQUEST_ID


def test_setup_logging_wires_the_request_id_formatter_onto_stdout():
    setup_logging()
    root = logging.getLogger()
    formatters = [handler.formatter for handler in root.handlers]
    assert any(isinstance(formatter, RequestIdFormatter) for formatter in formatters)


# --- healthz --------------------------------------------------------------


def test_a_passing_probe_reports_healthy():
    report = run_health_checks({"database": lambda: None})
    assert isinstance(report, HealthReport)
    assert report.ok is True
    assert report.as_dict()["ok"] is True
    assert report.as_dict()["checks"] == {"database": "ok"}


def test_a_raising_probe_reports_unhealthy():
    def boom() -> None:
        raise RuntimeError("connection refused to db.example.internal:5432")

    report = run_health_checks({"database": boom})
    assert report.ok is False
    assert report.as_dict()["checks"] == {"database": "error: RuntimeError"}


def test_a_failure_detail_never_leaks_the_exception_message():
    # Database errors quote DSNs, hosts, and sometimes credentials. /healthz
    # is public and unauthenticated: the type is all it may say.
    def boom() -> None:
        raise RuntimeError("postgres://user:hunter2@db.internal/flightcheck")

    detail = run_health_checks({"database": boom}).as_dict()["checks"]["database"]
    assert "hunter2" not in detail
    assert "postgres" not in detail


def test_a_hanging_probe_times_out_instead_of_hanging_healthz():
    # The liveness lie that let a dead build keep serving was one failure
    # mode; a healthz that blocks forever on a slow dependency is the other.
    def slow() -> None:
        time.sleep(5)

    started = time.monotonic()
    report = run_health_checks({"database": slow}, timeout_s=0.05)
    elapsed = time.monotonic() - started
    assert report.ok is False
    assert report.as_dict()["checks"] == {"database": "timeout"}
    assert elapsed < 2.0


def test_one_failing_check_fails_the_whole_report():
    report = run_health_checks(
        {"database": lambda: None, "other": lambda: 1 / 0},
    )
    assert report.ok is False
    assert report.as_dict()["checks"]["database"] == "ok"


def test_the_report_names_the_build_that_answered(monkeypatch):
    # "Which build is serving?" is the question the incident could not
    # answer: a dead Railway build kept serving while every new deploy
    # failed, and healthz said ok either way.
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "deadbeef")
    assert run_health_checks({}).as_dict()["release"] == "deadbeef"


def test_the_release_is_null_when_the_platform_does_not_say(monkeypatch):
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    monkeypatch.delenv("RAILWAY_DEPLOYMENT_ID", raising=False)
    assert run_health_checks({}).as_dict()["release"] is None


def test_the_default_timeout_is_short_enough_for_a_platform_health_check():
    assert 0 < HEALTH_PROBE_TIMEOUT_S <= 5.0


def test_no_probes_is_healthy_but_says_so():
    report = run_health_checks({})
    assert report.ok is True
    assert report.as_dict()["checks"] == {}


# --- the database probe ---------------------------------------------------


def test_the_database_probe_passes_when_the_database_answers():
    db = FakeDatabase()
    probe = database_probe(db)
    probe()  # a "no such package" answer IS a completed round trip


def test_the_database_probe_fails_when_the_database_does_not_answer():
    class DeadDatabase:
        def get_package_by_token(self, access_token: str) -> object:
            raise ConnectionError("no route to host")

    with pytest.raises(ConnectionError):
        database_probe(DeadDatabase())()


def test_the_database_probe_reads_nothing_real():
    # It must not depend on any row existing, and must not create one.
    db = FakeDatabase()
    database_probe(db)()
    assert db.packages == {}


def test_the_probe_and_the_runner_compose():
    # The two halves /healthz is meant to serve, together. The endpoint that
    # calls them lives in api/routers/ops.py, which this track does not own;
    # until that wiring lands, /healthz still answers unconditionally and
    # nothing here proves otherwise.
    report = run_health_checks({"database": database_probe(FakeDatabase())})
    assert report.ok is True
