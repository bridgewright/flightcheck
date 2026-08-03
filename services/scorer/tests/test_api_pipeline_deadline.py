"""F-37: the pipelines stop at a stage boundary when the budget is spent.

The audit measured the shape of the problem: each Gemini call carries a
480s HTTP timeout, and a scoring run makes ten of them, so a bad afternoon
at the provider turns one job into a 50-minute occupation of a worker
thread. The deadline cannot interrupt a call in flight -- these are
synchronous SDK calls -- so what it guarantees is that the NEXT stage never
starts. These tests pin exactly that, and pin that the row still ends
"failed" rather than stuck.
"""
from __future__ import annotations

import pytest

from factories import make_rubric
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.pipeline import compile_package, score_session
from scorer.resilience import DeadlineExceeded, deadline_scope


class _Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def _scorable_session(db: FakeDatabase) -> str:
    package = db.create_package("jd text", None, user_id="user-1")
    db.set_package_rubric(package.id, make_rubric(), "ready")
    row = db.create_session(package.id, 1, None)
    db.set_session_status(row.id, "scoring", audio_path="rec.webm")
    return row.id


def test_scoring_stops_at_the_next_stage_when_the_budget_is_spent(monkeypatch):
    db = FakeDatabase()
    storage = FakeStorage(recordings={"rec.webm": b"audio"})
    session_id = _scorable_session(db)
    clock = _Clock()

    real_download = storage.download_recording

    def slow_download(path, dest_dir):
        clock.advance(999.0)      # this one call blows the whole budget
        return real_download(path, dest_dir)

    monkeypatch.setattr(storage, "download_recording", slow_download)
    monkeypatch.setattr("scorer.api.pipeline.ensure_wav", lambda p: p)
    monkeypatch.setattr(
        "scorer.api.pipeline.sf.info",
        lambda _p: type("I", (), {"duration": 900.0})(),
    )
    transcribed = {"called": False}
    monkeypatch.setattr(
        "scorer.api.pipeline.transcribe_verbatim",
        lambda *_a: transcribed.update(called=True) or [],
    )

    with deadline_scope(60.0, monotonic=clock):
        with pytest.raises(DeadlineExceeded):
            score_session(session_id, db, storage, FakeGenAI([]))

    assert transcribed["called"] is False, (
        "an overrun job must not buy the most expensive call in the pipeline"
    )
    assert db.get_session(session_id).status == "failed"


def test_scoring_inside_its_budget_is_untouched(monkeypatch, permissive_eligibility):
    db = FakeDatabase()
    storage = FakeStorage(recordings={"rec.webm": b"audio"})
    session_id = _scorable_session(db)
    monkeypatch.setattr("scorer.api.pipeline.ensure_wav", lambda p: p)
    monkeypatch.setattr(
        "scorer.api.pipeline.sf.info",
        lambda _p: type("I", (), {"duration": 900.0})(),
    )
    monkeypatch.setattr("scorer.api.pipeline.transcribe_verbatim", lambda *_a: [])
    monkeypatch.setattr("scorer.api.pipeline.check_eligibility",
                        lambda *_a: "insufficient")

    with deadline_scope(600.0, monotonic=_Clock()):
        assert score_session(session_id, db, storage, FakeGenAI([])) is None

    assert db.get_session(session_id).status == "insufficient"


def test_compile_stops_before_the_research_sweep_when_the_budget_is_spent(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path))
    db = FakeDatabase()
    package = db.create_package("jd text", None, user_id="user-1")
    clock = _Clock()
    swept = {"called": False}

    def slow_facts(*_args):
        clock.advance(999.0)
        return type("F", (), {"role_title": "PM", "company": None})()

    monkeypatch.setattr("scorer.api.pipeline._extract_jd_facts", slow_facts)
    monkeypatch.setattr(
        "scorer.api.pipeline.run_sweep",
        lambda *_a: swept.update(called=True),
    )

    with deadline_scope(60.0, monotonic=clock):
        compile_package(package.id, db, FakeStorage(), FakeGenAI([]))

    assert swept["called"] is False
    assert db.get_package(package.id).status == "failed", (
        "compile_package records its own failure; the deadline is just "
        "another reason it did not finish"
    )


def test_no_deadline_bound_means_no_enforcement(monkeypatch, permissive_eligibility):
    """score_session stays directly callable from tools and tests."""
    db = FakeDatabase()
    storage = FakeStorage(recordings={"rec.webm": b"audio"})
    session_id = _scorable_session(db)
    monkeypatch.setattr("scorer.api.pipeline.ensure_wav", lambda p: p)
    monkeypatch.setattr(
        "scorer.api.pipeline.sf.info",
        lambda _p: type("I", (), {"duration": 900.0})(),
    )
    monkeypatch.setattr("scorer.api.pipeline.transcribe_verbatim", lambda *_a: [])
    monkeypatch.setattr("scorer.api.pipeline.check_eligibility",
                        lambda *_a: "insufficient")

    assert score_session(session_id, db, storage, FakeGenAI([])) is None


def test_a_retry_inside_the_pipeline_also_respects_the_budget(monkeypatch):
    """The deadline reaches the shared retry helper, not just stage edges."""
    from google.genai import errors as genai_errors

    from scorer.api.pipeline import _extract_jd_facts

    clock = _Clock()
    calls = {"n": 0}

    def flaky(*, model, contents, config=None):
        calls["n"] += 1
        clock.advance(999.0)
        raise genai_errors.APIError(503, {"error": {"message": "overloaded"}})

    fake = FakeGenAI([])
    monkeypatch.setattr(fake.models, "generate_content", flaky)

    with deadline_scope(60.0, monotonic=clock):
        with pytest.raises(DeadlineExceeded):
            _extract_jd_facts("a job description", fake)

    assert calls["n"] == 1
