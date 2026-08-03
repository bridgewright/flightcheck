"""The background-job wrappers, tested without an HTTP request.

Both jobs run as FastAPI BackgroundTasks, which means an exception that
escapes takes the worker's event loop with it. That contract is the whole
reason these wrappers exist, and it is worth testing directly: v0.6 Track B
wraps them with a concurrency semaphore, an overall deadline, and a
dead-letter path, and every one of those additions must keep it.
"""
import logging

import pytest

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.jobs import compile_package_job, score_session_job


@pytest.fixture
def collaborators():
    return FakeDatabase(), FakeStorage(), FakeGenAI([])


def test_score_session_job_forwards_its_arguments(monkeypatch, collaborators):
    db, storage, client = collaborators
    seen = {}
    monkeypatch.setattr(
        "scorer.api.jobs.score_session",
        lambda *args: seen.update(args=args),
    )
    score_session_job("sess-1", db, storage, client)
    assert seen["args"] == ("sess-1", db, storage, client)


def test_score_session_job_swallows_and_logs_a_failure(
    monkeypatch, caplog, collaborators
):
    def boom(*_args):
        raise RuntimeError("scoring exploded")

    monkeypatch.setattr("scorer.api.jobs.score_session", boom)
    with caplog.at_level(logging.ERROR):
        score_session_job("sess-1", *collaborators)  # must not raise
    assert "background scoring failed: session_id=sess-1" in caplog.text


def test_compile_package_job_forwards_its_arguments(monkeypatch, collaborators):
    db, storage, client = collaborators
    seen = {}
    monkeypatch.setattr(
        "scorer.api.jobs.compile_package",
        lambda *args, **kwargs: seen.update(args=args, kwargs=kwargs),
    )
    compile_package_job(
        "pkg-1", db, storage, client, resume_text="r", linkedin_text="l"
    )
    assert seen["args"] == ("pkg-1", db, storage, client)
    assert seen["kwargs"] == {"resume_text": "r", "linkedin_text": "l"}


def test_compile_package_job_swallows_the_double_fault(
    monkeypatch, caplog, collaborators
):
    # compile_package records "failed" itself; this covers the case where
    # even that status write throws (a database outage). The row may stay
    # "compiling" until the reaper or a retry clears it -- but the worker
    # stays up.
    def boom(*_args, **_kwargs):
        raise RuntimeError("database is gone")

    monkeypatch.setattr("scorer.api.jobs.compile_package", boom)
    with caplog.at_level(logging.ERROR):
        compile_package_job(
            "pkg-1", *collaborators, resume_text=None, linkedin_text=None
        )
    assert "background compile failed: package_id=pkg-1" in caplog.text
