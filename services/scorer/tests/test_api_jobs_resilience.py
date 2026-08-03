"""F-37: what the background-job wrappers do before and after the pipeline.

Three production incidents shape these tests.

* Two concurrent scoring runs at a measured ~1.6GB peak each OOMed the
  container, taking every in-flight session with them. Scoring is now
  serialised, and a run that cannot get the slot fails its own row instead
  of queueing forever or dying with the box.
* A job that chained per-call timeouts held a worker thread for the better
  part of an hour. Every job now carries an overall deadline.
* A failed job left a row saying "failed" and nothing saying why, so
  failures were found by customer complaint. Every job-level failure is now
  dead-lettered.

The wrappers' original contract still holds throughout: a BackgroundTask
that raises takes the event loop down, so nothing here may propagate.
"""
from __future__ import annotations

import logging
import threading

import pytest

from factories import make_rubric
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api import jobs as jobs_module
from scorer.api.deadletter import (
    REASON_DEADLINE,
    REASON_LOW_MEMORY,
    REASON_NO_SLOT,
    REASON_PIPELINE_ERROR,
    default_log,
    reset_default_log,
)
from scorer.api.jobs import compile_package_job, score_session_job
from scorer.resilience import (
    DeadlineExceeded,
    MemoryTooLow,
    current_deadline,
    load_resilience_config,
)


@pytest.fixture(autouse=True)
def fresh_state():
    reset_default_log()
    jobs_module.reset_slots()
    yield
    reset_default_log()
    jobs_module.reset_slots()


@pytest.fixture
def collaborators():
    return FakeDatabase(), FakeStorage(), FakeGenAI([])


def _tune(monkeypatch, **scoring):
    """Patch the resilience config the job wrappers read."""
    cfg = load_resilience_config()
    patched = cfg.model_copy(update={
        "scoring": cfg.scoring.model_copy(update=scoring),
    })
    monkeypatch.setattr(jobs_module, "load_resilience_config", lambda: patched)
    return patched


def _session_row(db: FakeDatabase) -> str:
    package = db.create_package("jd", None, user_id="user-1")
    db.set_package_rubric(package.id, make_rubric(), "ready")
    row = db.create_session(package.id, 1, None)
    db.set_session_status(row.id, "scoring", audio_path="rec.webm")
    return row.id


# ------------------------------------------------------------- deadline


def test_scoring_runs_under_a_deadline_from_config(monkeypatch, collaborators):
    _tune(monkeypatch, deadline_s=1234.0)
    seen: dict[str, float] = {}

    def capture(*_args):
        deadline = current_deadline()
        assert deadline is not None
        seen["budget"] = deadline.budget_s

    monkeypatch.setattr(jobs_module, "score_session", capture)

    score_session_job("sess-1", *collaborators)

    assert seen["budget"] == 1234.0


def test_the_deadline_is_cleared_after_the_job(monkeypatch, collaborators):
    monkeypatch.setattr(jobs_module, "score_session", lambda *_a: None)
    score_session_job("sess-1", *collaborators)
    assert current_deadline() is None


def test_compile_runs_under_its_own_deadline(monkeypatch, collaborators):
    cfg = load_resilience_config()
    seen: dict[str, float] = {}

    def capture(*_args, **_kwargs):
        seen["budget"] = current_deadline().budget_s

    monkeypatch.setattr(jobs_module, "compile_package", capture)

    compile_package_job("pkg-1", *collaborators, resume_text=None,
                        linkedin_text=None)

    assert seen["budget"] == cfg.compile.deadline_s


def test_a_deadline_overrun_is_dead_lettered_as_such(monkeypatch, collaborators):
    def overrun(*_args):
        raise DeadlineExceeded("job deadline of 1800s exceeded before 'compile'")

    monkeypatch.setattr(jobs_module, "score_session", overrun)

    score_session_job("sess-1", *collaborators)  # must not raise

    entry = default_log().recent()[0]
    assert (entry.kind, entry.subject_id, entry.reason) == (
        "scoring", "sess-1", REASON_DEADLINE)


# ---------------------------------------------------------- concurrency


def test_only_one_scoring_run_holds_the_slot(monkeypatch, collaborators):
    _tune(monkeypatch, max_concurrency=1, queue_wait_s=5.0)
    inside = threading.Semaphore(0)
    release = threading.Event()
    peak = {"value": 0, "live": 0}
    lock = threading.Lock()

    def slow(*_args):
        with lock:
            peak["live"] += 1
            peak["value"] = max(peak["value"], peak["live"])
        inside.release()
        release.wait(timeout=5.0)
        with lock:
            peak["live"] -= 1

    monkeypatch.setattr(jobs_module, "score_session", slow)
    threads = [
        threading.Thread(target=score_session_job,
                         args=(f"sess-{index}", *collaborators))
        for index in range(3)
    ]
    for thread in threads:
        thread.start()
    inside.acquire(timeout=5.0)
    release.set()
    for thread in threads:
        thread.join(timeout=5.0)

    assert peak["value"] == 1, (
        "two concurrent scorings are ~3.2GB and have already OOMed production"
    )


def test_a_run_that_cannot_get_a_slot_fails_its_row_instead_of_hanging(
    monkeypatch, collaborators
):
    db, storage, client = collaborators
    session_id = _session_row(db)
    _tune(monkeypatch, max_concurrency=1, queue_wait_s=0.01)
    started = threading.Event()
    release = threading.Event()

    def blocker(*_args):
        started.set()
        release.wait(timeout=5.0)

    monkeypatch.setattr(jobs_module, "score_session", blocker)
    holder = threading.Thread(target=score_session_job,
                             args=("sess-holder", db, storage, client))
    holder.start()
    started.wait(timeout=5.0)

    score_session_job(session_id, db, storage, client)  # must not raise

    release.set()
    holder.join(timeout=5.0)
    assert db.get_session(session_id).status == "failed", (
        "a row left 'scoring' waits half an hour for the reaper; the customer "
        "should be able to retry now"
    )
    entry = default_log().recent()[0]
    assert entry.reason == REASON_NO_SLOT


# --------------------------------------------------------------- memory


def test_a_scoring_run_is_refused_when_memory_is_too_low(monkeypatch, collaborators):
    db, storage, client = collaborators
    session_id = _session_row(db)
    ran = {"called": False}

    def boom(*_args, **_kwargs):
        raise MemoryTooLow("scoring needs 512MB of headroom; only 90MB is available")

    monkeypatch.setattr(jobs_module, "require_memory", boom)
    monkeypatch.setattr(jobs_module, "score_session",
                        lambda *_a: ran.update(called=True))

    score_session_job(session_id, db, storage, client)

    assert ran["called"] is False, "the guard must run BEFORE the 1.6GB download"
    assert db.get_session(session_id).status == "failed"
    assert default_log().recent()[0].reason == REASON_LOW_MEMORY


def test_the_observed_memory_figure_is_logged_at_every_job_start(
    monkeypatch, caplog, collaborators
):
    """The floor can only be tuned honestly if each start records what it saw."""
    monkeypatch.setattr(jobs_module, "require_memory", lambda *_a, **_k: 812.5)
    monkeypatch.setattr(jobs_module, "score_session", lambda *_a: None)

    with caplog.at_level(logging.INFO, logger="scorer.api.jobs"):
        score_session_job("sess-1", *collaborators)

    assert "812" in caplog.text


def test_an_unmeasurable_host_does_not_block_scoring(monkeypatch, collaborators):
    monkeypatch.setattr(jobs_module, "require_memory", lambda *_a, **_k: None)
    ran = {"called": False}
    monkeypatch.setattr(jobs_module, "score_session",
                        lambda *_a: ran.update(called=True))

    score_session_job("sess-1", *collaborators)

    assert ran["called"] is True


# ---------------------------------------------------------- dead letters


def test_a_pipeline_failure_is_dead_lettered(monkeypatch, collaborators):
    def boom(*_args):
        raise RuntimeError("scoring exploded")

    monkeypatch.setattr(jobs_module, "score_session", boom)

    score_session_job("sess-1", *collaborators)

    entry = default_log().recent()[0]
    assert entry.reason == REASON_PIPELINE_ERROR
    assert entry.error_type == "RuntimeError"


def test_a_compile_failure_is_dead_lettered_and_the_package_fails(
    monkeypatch, collaborators
):
    db, storage, client = collaborators
    package = db.create_package("jd", None, user_id="user-1")

    def boom(*_args, **_kwargs):
        raise MemoryTooLow("no headroom")

    monkeypatch.setattr(jobs_module, "compile_package", boom)

    compile_package_job(package.id, db, storage, client, resume_text=None,
                        linkedin_text=None)

    assert db.get_package(package.id).status == "failed"
    entry = default_log().recent()[0]
    assert (entry.kind, entry.subject_id) == ("compile", package.id)


def test_the_row_failure_write_can_itself_fail_without_killing_the_worker(
    monkeypatch, collaborators
):
    db, storage, client = collaborators

    def boom(*_args):
        raise RuntimeError("scoring exploded")

    def dead_db(*_args, **_kwargs):
        raise RuntimeError("database is gone")

    monkeypatch.setattr(jobs_module, "score_session", boom)
    monkeypatch.setattr(db, "get_session", dead_db)

    score_session_job("sess-1", db, storage, client)  # must not raise

    assert default_log().recent()[0].reason == REASON_PIPELINE_ERROR


def test_a_row_the_pipeline_already_failed_is_not_rewritten(
    monkeypatch, collaborators
):
    db, storage, client = collaborators
    session_id = _session_row(db)
    writes: list[tuple] = []
    real_set = db.set_session_status

    def spy(session, status, audio_path=None):
        writes.append((session, status))
        real_set(session, status, audio_path=audio_path)

    monkeypatch.setattr(db, "set_session_status", spy)

    def fail_like_the_pipeline(session, *_args):
        db.set_session_status(session, "failed")
        raise RuntimeError("scoring exploded")

    monkeypatch.setattr(jobs_module, "score_session", fail_like_the_pipeline)

    score_session_job(session_id, db, storage, client)

    assert writes == [(session_id, "failed")], (
        "the wrapper must not double-write a status the pipeline already set"
    )


# --------------------------------------------------------- scoring latency


def test_a_successful_run_records_its_duration_for_the_usage_metrics(
    monkeypatch, collaborators
):
    """F-13's p50 has no column behind it; the job is where it is sampled."""
    from scorer.api.usage import reset_scoring_latency, scoring_latency

    reset_scoring_latency()
    monkeypatch.setattr(jobs_module, "score_session", lambda *_a: None)

    score_session_job("sess-1", *collaborators)

    assert scoring_latency().sample_size == 1
    reset_scoring_latency()


def test_a_failed_run_records_no_duration(monkeypatch, collaborators):
    """A run that died is not a latency observation; it is a dead letter."""
    from scorer.api.usage import reset_scoring_latency, scoring_latency

    reset_scoring_latency()

    def boom(*_args):
        raise RuntimeError("scoring exploded")

    monkeypatch.setattr(jobs_module, "score_session", boom)

    score_session_job("sess-1", *collaborators)

    assert scoring_latency().sample_size == 0
    reset_scoring_latency()
