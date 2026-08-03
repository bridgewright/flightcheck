"""F-37 dead-letter path: a permanently failed job is recorded, not lost.

Before this, a job that died left one logger.exception line in a log stream
nobody was watching and a row whose status said "failed" without saying why.
The failure was discovered when the customer complained.
"""
from __future__ import annotations

import logging

import pytest

from scorer.api.deadletter import DeadLetter, DeadLetterLog, default_log, reset_default_log


@pytest.fixture(autouse=True)
def fresh_default_log():
    reset_default_log()
    yield
    reset_default_log()


def test_record_captures_the_job_the_subject_and_the_reason():
    log = DeadLetterLog(max_records=10)

    entry = log.record("scoring", "sess-1", ValueError("no audio"),
                       reason="pipeline-error")

    assert isinstance(entry, DeadLetter)
    assert entry.kind == "scoring"
    assert entry.subject_id == "sess-1"
    assert entry.reason == "pipeline-error"
    assert entry.error_type == "ValueError"
    assert "no audio" in entry.detail
    assert entry.occurred_at.endswith("+00:00")


def test_records_come_back_newest_first():
    log = DeadLetterLog(max_records=10)
    log.record("scoring", "sess-1", ValueError("a"), reason="pipeline-error")
    log.record("compile", "pkg-1", ValueError("b"), reason="pipeline-error")

    assert [r.subject_id for r in log.recent()] == ["pkg-1", "sess-1"]


def test_the_log_is_bounded_so_it_cannot_eat_the_worker():
    log = DeadLetterLog(max_records=3)
    for index in range(10):
        log.record("scoring", f"sess-{index}", ValueError("x"),
                   reason="pipeline-error")

    recent = log.recent()
    assert len(recent) == 3
    assert [r.subject_id for r in recent] == ["sess-9", "sess-8", "sess-7"]
    assert log.total_recorded == 10, "the count must not forget what it dropped"


def test_recent_honours_an_explicit_limit():
    log = DeadLetterLog(max_records=10)
    for index in range(5):
        log.record("scoring", f"sess-{index}", ValueError("x"), reason="err")
    assert len(log.recent(limit=2)) == 2


def test_detail_is_truncated_and_single_line():
    log = DeadLetterLog(max_records=5, detail_max_chars=40)

    entry = log.record("compile", "pkg-1",
                       ValueError("line one\nline two " + "x" * 200),
                       reason="pipeline-error")

    assert "\n" not in entry.detail
    assert len(entry.detail) <= 40


def test_recording_emits_one_greppable_error_line(caplog):
    log = DeadLetterLog(max_records=5)
    with caplog.at_level(logging.ERROR, logger="scorer.api.deadletter"):
        log.record("scoring", "sess-7", RuntimeError("boom"), reason="deadline")

    lines = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(lines) == 1
    assert "dead-letter" in lines[0]
    assert "sess-7" in lines[0] and "deadline" in lines[0]


def test_the_default_log_is_one_process_wide_instance():
    assert default_log() is default_log()


def test_the_default_log_is_sized_from_config():
    from scorer.resilience import load_resilience_config
    assert default_log().max_records == load_resilience_config().deadletter.max_records


def test_serialised_records_are_json_ready():
    log = DeadLetterLog(max_records=2)
    log.record("scoring", "sess-1", ValueError("x"), reason="no-slot")
    payload = [entry.model_dump(mode="json") for entry in log.recent()]
    assert payload[0]["reason"] == "no-slot"
    assert set(payload[0]) == {
        "kind", "subject_id", "reason", "error_type", "detail", "occurred_at",
    }
