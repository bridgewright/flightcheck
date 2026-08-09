"""Tests for scorer.api.pipeline -- compile and scoring pipelines (offline)."""
import io
import json

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.api.pipeline import compile_package, score_session
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    DimensionScore,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SessionReport,
    SilenceEvent,
    SourceCitation,
)
from scorer.sessionplan.planner import plan_baseline_session

JD_TEXT = "We are hiring a Senior Product Analyst to own growth analytics."

CORPUS = {"example-public-guide.md": "# Example guide\nBehavioral anchors beat gut feel."}

PROFILE_JSON = json.dumps({
    "name": "Alex Example",
    "headline": "Senior Product Analyst",
    "years_experience": "4+ years",
    "roles": ["Senior Product Analyst, ExampleCorp"],
    "skills": ["SQL", "Python"],
    "achievements": ["Cut dashboard load time 40%"],
})

JD_FACTS_JSON = json.dumps({"role_title": "Senior Product Analyst", "company": None})

FINDINGS_JSON = json.dumps({
    "queries": [],
    "reported_questions": ["Walk me through a dashboard you built end to end."],
    "probe_areas": ["metric definitions"],
    "evaluation_signals": ["quantified impact"],
    "citations": [],
})


@pytest.fixture(autouse=True)
def _isolated_corpus_cache(monkeypatch, tmp_path):
    """Keep the corpus cache inside tmp_path even if the dev env sets it."""
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        # F-62 faithfulness: content dimensions quote JD_TEXT verbatim;
        # delivery dimensions carry None.
        jd_evidence="own growth analytics" if channel == "content" else None,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}: vague claims, no example."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}: one example, thin detail."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}: specific, quantified."),
        ],
        signals=[f"{name}: named specifics", f"{name}: measurable outcomes"],
        citations=[
            SourceCitation(
                url="https://example.com/interview-guide",
                title="Example interview guide",
                snippet=f"Interviewers probe {lowered} with follow-up questions.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.2),
            _dim("quantified-impact", "Quantified impact", "content", 0.2),
            _dim("role-knowledge", "Role knowledge", "content", 0.2),
            _dim("pacing-control", "Pacing control", "delivery", 0.2),
            _dim("composure", "Composure", "delivery", 0.2),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?", "What was the measurable outcome?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric used only by pipeline tests.",
    )


def _package_responses() -> list[str]:
    """One canned text per generate_content call, in pipeline order."""
    return [
        PROFILE_JSON,                        # build_profile
        JD_FACTS_JSON,                       # jd-facts extraction (company None -> 2 queries)
        "Research prose block 1",            # run_sweep grounded call 1
        "Research prose block 2",            # run_sweep grounded call 2
        FINDINGS_JSON,                       # run_sweep structuring call
        _make_rubric().model_dump_json(),    # compile_rubric
    ]


def test_compile_package_ends_ready_with_rubric_and_profile():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None)
    fake = FakeGenAI(_package_responses())

    compile_package(
        row.id,
        db,
        FakeStorage(corpus=CORPUS),
        fake,
        resume_text="Alex Example. Senior Product Analyst.",
        linkedin_text=None,
    )

    stored = db.get_package(row.id)
    assert stored.status == "ready"
    assert stored.rubric is not None
    assert stored.rubric.role_title == "Forward Deployed Product Manager"
    assert stored.candidate_profile is not None
    assert stored.candidate_profile.name == "Alex Example"
    assert len(fake.calls) == 6


def test_compile_package_without_sources_uses_minimal_profile():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None)
    fake = FakeGenAI(_package_responses()[1:])   # no build_profile call

    compile_package(row.id, db, FakeStorage(corpus=CORPUS), fake)

    stored = db.get_package(row.id)
    assert stored.status == "ready"
    assert stored.candidate_profile is not None
    assert stored.candidate_profile.name is None
    assert stored.candidate_profile.roles == []
    assert len(fake.calls) == 5


def test_compile_package_records_failure_and_swallows():
    db = FakeDatabase()
    row = db.create_package(JD_TEXT, None)

    # No canned responses: the first LLM call raises. Returning without an
    # exception IS the assertion that compile_package swallowed it.
    compile_package(
        row.id, db, FakeStorage(), FakeGenAI([]),
        resume_text="resume text", linkedin_text=None,
    )

    stored = db.get_package(row.id)
    assert stored.status == "failed"
    assert stored.rubric is None


SEGMENTS_JSON = json.dumps({"segments": [
    {"start_s": 0.0, "end_s": 1.8, "speaker": "interviewer",
     "text": "Walk me through a project you led end to end."},
    {"start_s": 3.6, "end_s": 7.6, "speaker": "candidate",
     "text": "Um, I led the churn dashboard rollout and we cut churn by 12 percent."},
]})

# Nine judge replies (3 content dims x 3 samples). score_content's focused
# dimension calls run concurrently and pop the ordered script in no fixed
# order, so every reply carries all three dimensions' scores and is valid for
# whichever call pops it (the judge keeps only the score for the dimension it
# asked about).
CONTENT_SCORES_JSONS = [json.dumps({"scores": [
    {"dimension_key": "structured-answers", "score": 4.0,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": "One clear arc from ownership to outcome, near the score-5 anchor."},
    {"dimension_key": "quantified-impact", "score": 4.5,
     "evidence_quotes": ["we cut churn by 12 percent"],
     "rationale": "Quantified outcome stated directly, matching the score-5 anchor."},
    {"dimension_key": "role-knowledge", "score": 3.5,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": "One concrete example with thin surrounding detail."},
]})] * 9

DELIVERY_JUDGE_JSON = json.dumps({
    "scores": [
        {"dimension_key": "pacing-control", "score": 4.0,
         "evidence_quotes": ["03:36-07:36 steady pace"],
         "rationale": "Pace stays steady across the answer window."},
        {"dimension_key": "composure", "score": 4.0,
         "evidence_quotes": ["00:02 pause then structured answer"],
         "rationale": "Signals associated with recovery observed after the opening pause."},
    ],
    "observations": [
        {"at_s": 2.0, "kind": "long-pause",
         "note": "Silence of 1.8 seconds observed before the first answer.",
         "conflicts_with_dsp": False},
    ],
})


def _wav_bytes(duration_s: float = 8.0, sample_rate: int = 16000) -> bytes:
    """Synthesized recording (house rule: no committed audio binaries).

    A 220 Hz tone with a silence gap matching the canned transcript's gap
    between the interviewer segment (ends 1.8s) and the candidate segment
    (starts 3.6s).
    """
    t = np.linspace(0.0, duration_s, int(sample_rate * duration_s), endpoint=False)
    audio = 0.3 * np.sin(2 * np.pi * 220.0 * t)
    audio[int(1.8 * sample_rate):int(3.6 * sample_rate)] = 0.0
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _seed_scorable_session(db: FakeDatabase, audio_path: str):
    package = db.create_package(JD_TEXT, None)
    db.set_package_rubric(package.id, _make_rubric(), status="ready")
    session = db.create_session(package.id, 1, plan_baseline_session(_make_rubric()))
    db.set_session_status(session.id, "planned", audio_path=audio_path)
    return session


def test_quick_session_is_refused_at_scoring_entry_point():
    db = FakeDatabase()
    package = db.create_quick_package("user-1", "Acme", "Engineer")
    session = db.create_session(package.id, 1, None)
    with pytest.raises(ValueError, match="cannot enter scoring"):
        score_session(session.id, db, FakeStorage(), FakeGenAI([]))
    assert db.get_session(session.id).status == "failed"


def test_score_session_saves_scored_report(permissive_eligibility):
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    fake = FakeGenAI([SEGMENTS_JSON, *CONTENT_SCORES_JSONS, DELIVERY_JUDGE_JSON])

    report = score_session(session.id, db, storage, fake)

    assert report.session_id == session.id
    assert report.verdict == "ready"          # 0.2 * (4.0+4.5+3.5+4.0+4.0) = 4.0
    assert report.overall_score == 4.0
    assert report.headline                    # F-03: always populated
    assert len(report.dimension_scores) == 5  # both channels merged
    stored = db.get_session(session.id)
    assert stored.status == "scored"
    assert stored.report is not None
    assert stored.report.verdict == "ready"
    transcript = db.get_transcript(session.id)
    assert transcript is not None
    assert [seg.model_dump(mode="json") for seg in transcript] == (
        json.loads(SEGMENTS_JSON)["segments"]
    )


def test_judge_failure_still_leaves_the_transcript_persisted(permissive_eligibility):
    # The transcript is saved immediately after the transcribe stage, BEFORE
    # any judge runs: the 20-minute interview is not repeatable, so a judge
    # failure must leave the transcript on the failed row.
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    # Only the transcribe reply is scripted: the first content-judge call
    # exhausts the script and raises.
    fake = FakeGenAI([SEGMENTS_JSON])

    with pytest.raises(IndexError):
        score_session(session.id, db, storage, fake)

    stored = db.get_session(session.id)
    assert stored.status == "failed"
    assert stored.report is None
    transcript = db.get_transcript(session.id)
    assert transcript is not None
    assert [seg.model_dump(mode="json") for seg in transcript] == (
        json.loads(SEGMENTS_JSON)["segments"]
    )


def test_score_session_records_stage_progression_and_clears_on_completion(
    permissive_eligibility,
):
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    fake = FakeGenAI([SEGMENTS_JSON, *CONTENT_SCORES_JSONS, DELIVERY_JUDGE_JSON])

    score_session(session.id, db, storage, fake)

    # Coarse stage marker advances through every pipeline boundary, in order.
    assert db.stage_writes == [
        (session.id, "download"),
        (session.id, "transcribe"),
        (session.id, "delivery-metrics"),
        (session.id, "content-judge"),
        (session.id, "delivery-judge"),
        (session.id, "compile"),
    ]
    # The terminal "scored" write clears the stage: a finished row never
    # keeps a stale in-progress marker.
    assert db.get_session(session.id).scoring_stage is None


def test_insufficient_session_skips_judges_and_preserves_the_slot():
    # F-04 with the REAL config: an 8-second recording is far below the
    # 600s/5-turn/200-word floors, so the run must stop after transcription
    # -- zero judge calls (the paid spend), no report, terminal status
    # "insufficient" (retriable; the slot is not burned), transcript kept.
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    # Only the transcribe reply is scripted: any judge call would raise
    # IndexError, so a clean return proves no judge ran.
    fake = FakeGenAI([SEGMENTS_JSON])

    result = score_session(session.id, db, storage, fake)

    assert result is None
    stored = db.get_session(session.id)
    assert stored.status == "insufficient"
    assert stored.report is None
    assert stored.scoring_stage is None      # terminal write clears the stage
    assert len(fake.calls) == 1              # transcription only, zero judges
    transcript = db.get_transcript(session.id)
    assert transcript is not None            # evidence survives the verdict


def test_limited_session_scores_with_the_limited_marker(monkeypatch):
    # F-04: above the hard floors but below the full-evidence bars, the
    # session scores normally and the report carries eligibility="limited".
    from scorer.config import load_product_config as real_load
    cfg = real_load()
    limited_cfg = cfg.model_copy(update={
        "eligibility": cfg.eligibility.model_copy(update={
            "min_duration_s": 0.0,
            "min_candidate_turns": 0,
            "min_candidate_words": 0,
        })
    })
    monkeypatch.setattr(
        "scorer.api.pipeline.load_product_config", lambda: limited_cfg
    )
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    fake = FakeGenAI([SEGMENTS_JSON, *CONTENT_SCORES_JSONS, DELIVERY_JUDGE_JSON])

    report = score_session(session.id, db, storage, fake)

    assert report is not None
    assert report.eligibility == "limited"
    assert "limited evidence" in report.limits_note
    assert db.get_session(session.id).status == "scored"


def test_score_session_records_failure_and_reraises():
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/missing.wav")

    # Empty storage: download_recording raises KeyError before any LLM call.
    with pytest.raises(KeyError):
        score_session(session.id, db, FakeStorage(), FakeGenAI([]))

    stored = db.get_session(session.id)
    assert stored.status == "failed"
    assert stored.report is None
    assert stored.scoring_stage is None   # terminal "failed" clears the stage


def _package_client(fake: FakeGenAI, db: FakeDatabase) -> TestClient:
    return TestClient(create_app(db, FakeStorage(corpus=CORPUS), fake))


def _post_package(client: TestClient, body: dict[str, str]):
    return client.post(
        "/api/packages",
        json=body,
        headers={"Authorization": "Bearer test-worker-token"},
    )


def test_same_user_same_jd_reuses_rubric_without_recompile(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI(_package_responses()[1:])
    client = _package_client(fake, db)

    first = _post_package(client, {"jd_text": JD_TEXT, "user_id": "user-1"})
    first_row = db.get_package(first.json()["package_id"])
    call_count = len(fake.calls)

    second = _post_package(client, {"jd_text": JD_TEXT, "user_id": "user-1"})
    second_row = db.get_package(second.json()["package_id"])

    assert second_row.status == "ready"
    assert second_row.rubric == first_row.rubric
    assert len(fake.calls) == call_count


def test_create_package_binds_user_id_when_given(monkeypatch):
    # Packages are born bound: the auth-gated /new route sends the creating
    # account's id, so the row never goes through an unclaimed phase.
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI(_package_responses()[1:])
    client = _package_client(fake, db)

    response = _post_package(client, {"jd_text": JD_TEXT, "user_id": "user-7"})

    assert response.status_code == 202
    assert db.get_package(response.json()["package_id"]).user_id == "user-7"


def test_create_package_without_user_id_stays_unbound(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI(_package_responses()[1:])
    client = _package_client(fake, db)

    response = _post_package(client, {"jd_text": JD_TEXT})

    assert response.status_code == 202
    assert db.get_package(response.json()["package_id"]).user_id is None


def test_package_creation_stops_at_the_per_account_cap(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI([])       # a compile of any kind would raise IndexError
    client = _package_client(fake, db)
    for i in range(10):
        db.create_package(f"{JD_TEXT} {i}", None, user_id="user-1")

    response = _post_package(client, {"jd_text": JD_TEXT, "user_id": "user-1"})

    assert response.status_code == 429
    assert "limit" in response.json()["error"]
    assert len(db.list_packages_by_user("user-1")) == 10   # nothing created


def test_package_creation_below_the_cap_still_succeeds(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI(_package_responses()[1:])
    client = _package_client(fake, db)
    for i in range(9):
        db.create_package(f"{JD_TEXT} {i}", None, user_id="user-1")

    response = _post_package(client, {"jd_text": JD_TEXT, "user_id": "user-1"})

    assert response.status_code == 202
    assert len(db.list_packages_by_user("user-1")) == 10


def test_unowned_package_creation_is_not_capped(monkeypatch):
    # The cap counts one account's packages; an unowned request has no account
    # to count, and the web app can no longer make one (package creation is
    # auth-gated), so this path is left exactly as it was.
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI(_package_responses()[1:])
    client = _package_client(fake, db)
    for i in range(10):
        db.create_package(f"{JD_TEXT} {i}", None)

    response = _post_package(client, {"jd_text": JD_TEXT})

    assert response.status_code == 202


def test_another_account_never_reuses_a_cached_package(monkeypatch):
    # The cached row carries the source account's candidate_profile, which the
    # reuse path copies onto the new package -- and the live interviewer greets
    # the candidate by the name in that profile. A second account posting the
    # same JD must therefore compile its own package, never inherit this one.
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI([*_package_responses(), *_package_responses()[1:]])
    client = _package_client(fake, db)

    first = _post_package(client, {
        "jd_text": JD_TEXT,
        "resume_text": "Alex Example. Senior Product Analyst.",
        "user_id": "user-1",
    })
    first_row = db.get_package(first.json()["package_id"])
    assert first_row.candidate_profile.name == "Alex Example"
    call_count = len(fake.calls)

    second = _post_package(client, {"jd_text": JD_TEXT, "user_id": "user-2"})

    second_row = db.get_package(second.json()["package_id"])
    assert second_row.status == "ready"
    assert second_row.user_id == "user-2"
    assert len(fake.calls) > call_count            # compiled, not copied
    assert second_row.candidate_profile.name is None


def test_unowned_package_never_reuses_a_cached_package(monkeypatch):
    # Reuse requires a concrete owner match on both sides: an unowned row is
    # not "owned by nobody in common", so two anonymous packages must not
    # share a compile either.
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI([*_package_responses()[1:], *_package_responses()[1:]])
    client = _package_client(fake, db)

    _post_package(client, {"jd_text": JD_TEXT})
    call_count = len(fake.calls)
    second = _post_package(client, {"jd_text": JD_TEXT})

    assert db.get_package(second.json()["package_id"]).status == "ready"
    assert len(fake.calls) > call_count


def test_different_jd_still_compiles(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI([*_package_responses()[1:], *_package_responses()[1:]])
    client = _package_client(fake, db)

    _post_package(client, {"jd_text": JD_TEXT})
    call_count = len(fake.calls)
    second = _post_package(client, {"jd_text": f"{JD_TEXT} Different role."})

    assert db.get_package(second.json()["package_id"]).status == "ready"
    assert len(fake.calls) > call_count


def test_personalized_package_skips_cache(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI([*_package_responses()[1:], *_package_responses()])
    client = _package_client(fake, db)

    _post_package(client, {"jd_text": JD_TEXT})
    call_count = len(fake.calls)
    second = _post_package(
        client,
        {"jd_text": JD_TEXT, "resume_text": "Alex Example. Senior Product Analyst."},
    )

    assert db.get_package(second.json()["package_id"]).status == "ready"
    assert len(fake.calls) > call_count


def test_failed_compile_is_not_a_cache_source(monkeypatch):
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    db = FakeDatabase()
    fake = FakeGenAI([RuntimeError("scripted compile failure"), *_package_responses()[1:]])
    client = _package_client(fake, db)

    first = _post_package(client, {"jd_text": JD_TEXT})
    assert db.get_package(first.json()["package_id"]).status == "failed"
    call_count = len(fake.calls)

    second = _post_package(client, {"jd_text": JD_TEXT})

    assert db.get_package(second.json()["package_id"]).status == "ready"
    assert len(fake.calls) > call_count


API_HEADERS = {"Authorization": "Bearer test-worker-token"}


def _ready_package(db: FakeDatabase, *, total_sessions: int = 6, user_id=None,
                   paid_at: str | None = None):
    package = db.create_package(JD_TEXT, None)
    db.packages[package.id] = package.model_copy(
        update={"user_id": user_id, "total_sessions": total_sessions,
                "paid_at": paid_at}
    )
    db.set_package_rubric(package.id, _make_rubric(), status="ready")
    return db.get_package(package.id)


def _session_client(monkeypatch, db: FakeDatabase) -> TestClient:
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([])))


def _stored_report(session_id: str, *, verdict: str = "approaching",
                   overall: float = 3.4) -> SessionReport:
    """Compact stored report for listing/progress payload tests."""
    return SessionReport(
        session_id=session_id,
        verdict=verdict,
        overall_score=overall,
        dimension_scores=[
            DimensionScore(
                dimension_key="structured-answers", score=3.4,
                evidence_quotes=["I led the churn dashboard rollout"],
                rationale="One clear example with thin surrounding detail."),
            DimensionScore(
                dimension_key="pacing-control", score=3.8,
                evidence_quotes=["03:36-07:36 steady pace"],
                rationale="Pace stays steady across the answer window."),
        ],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=141.0, wpm_timeline=[140.0, 142.0],
            silence_events=[
                SilenceEvent(start_s=62.0, duration_s=2.5),
                SilenceEvent(start_s=240.0, duration_s=4.0),
            ],
            filler_count=4, filler_rate_per_min=1.2, f0_variance=700.0,
            avg_response_latency_s=1.3),
        delivery_observations=[],
        strengths=["Names outcomes without prompting."],
        gaps=["Answers stay at the summary level."],
        next_drills=["Drill: add one quantified detail per answer."],
        limits_note=("Scores reflect rubric agreement, "
                     "not an admission prediction."),
    )


def test_create_session_resumes_planned_session_without_creating_row(monkeypatch):
    db = FakeDatabase()
    package = _ready_package(db, paid_at="2026-08-03T00:00:00+00:00")
    planned = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    client = _session_client(monkeypatch, db)

    response = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=API_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["session_id"] == planned.id
    assert response.json()["index"] == 1
    assert len(db.sessions) == 1


def test_create_session_resume_prefers_lowest_retriable_index(monkeypatch):
    db = FakeDatabase()
    package = _ready_package(db, paid_at="2026-08-03T00:00:00+00:00")
    high = db.create_session(package.id, 3, plan_baseline_session(package.rubric))
    low = db.create_session(package.id, 2, plan_baseline_session(package.rubric))
    db.set_session_status(high.id, "failed")
    client = _session_client(monkeypatch, db)

    response = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=API_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["session_id"] == low.id
    assert len(db.sessions) == 2


def test_create_session_after_scored_session_uses_next_index(monkeypatch):
    db = FakeDatabase()
    package = _ready_package(db, paid_at="2026-08-03T00:00:00+00:00")
    first = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    db.set_session_status(first.id, "scored")
    client = _session_client(monkeypatch, db)

    response = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=API_HEADERS
    )

    assert response.status_code == 200
    assert response.json()["index"] == 2
    assert sorted(row.index for row in db.sessions.values()) == [1, 2]


def test_create_session_rejects_exhausted_package(monkeypatch):
    db = FakeDatabase()
    package = _ready_package(db, total_sessions=2,
                             paid_at="2026-08-03T00:00:00+00:00")
    for index in (1, 2):
        row = db.create_session(package.id, index, plan_baseline_session(package.rubric))
        db.set_session_status(row.id, "scored")
    client = _session_client(monkeypatch, db)

    response = client.post(
        "/api/sessions", json={"package_id": package.id}, headers=API_HEADERS
    )

    assert response.status_code == 409
    assert response.json() == {"error": "package exhausted: all 2 sessions used",
                               "code": "package-exhausted"}


def test_list_package_sessions_orders_and_shapes_payload(monkeypatch):
    db = FakeDatabase()
    package = _ready_package(db)
    second = db.create_session(package.id, 2, plan_baseline_session(package.rubric))
    first = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    db.set_session_status(second.id, "scored")
    client = _session_client(monkeypatch, db)

    response = client.get(
        f"/api/packages/{package.id}/sessions", headers=API_HEADERS
    )

    assert response.status_code == 200
    assert response.json() == {"sessions": [
        {"id": first.id, "index": 1, "status": "planned",
         "created_at": first.created_at, "scoring_stage": None,
         "stopped_reporting": False, "report_available": False,
         "overall": None, "verdict": None},
        {"id": second.id, "index": 2, "status": "scored",
         "created_at": second.created_at, "scoring_stage": None,
         "stopped_reporting": False, "report_available": False,
         "overall": None, "verdict": None},
    ]}


def test_list_package_sessions_carries_verdict_and_scoring_stage(monkeypatch):
    # WP-D: the archive renders verdicts and in-flight stages straight from
    # the summary — without these fields it would need an N+1 of full GETs.
    db = FakeDatabase()
    package = _ready_package(db)
    scoring = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    db.set_session_status(scoring.id, "scoring")
    db.set_scoring_stage(scoring.id, "content-judge")
    scored = db.create_session(package.id, 2, plan_baseline_session(package.rubric))
    db.save_report(scored.id, _stored_report(scored.id))
    client = _session_client(monkeypatch, db)

    response = client.get(
        f"/api/packages/{package.id}/sessions", headers=API_HEADERS
    )

    assert response.status_code == 200
    first, second = response.json()["sessions"]
    assert first["status"] == "scoring"
    assert first["scoring_stage"] == "content-judge"
    assert first["verdict"] is None
    assert second["status"] == "scored"
    assert second["scoring_stage"] is None
    assert second["verdict"] == "approaching"
    assert second["overall"] == 3.4
    assert second["report_available"] is True


def test_list_package_sessions_returns_404_and_requires_auth(monkeypatch):
    db = FakeDatabase()
    client = _session_client(monkeypatch, db)

    missing = client.get("/api/packages/missing/sessions", headers=API_HEADERS)
    unauthorized = client.get("/api/packages/missing/sessions")

    assert missing.status_code == 404
    assert unauthorized.status_code == 401


def test_progress_unknown_package_is_404_and_requires_auth(monkeypatch):
    db = FakeDatabase()
    client = _session_client(monkeypatch, db)

    missing = client.get("/api/packages/missing/progress", headers=API_HEADERS)
    unauthorized = client.get("/api/packages/missing/progress")

    assert missing.status_code == 404
    assert unauthorized.status_code == 401


def test_progress_shapes_scored_and_unscored_sessions(monkeypatch):
    # WP-C: one entry per session, ascending index, from ONE list call.
    # Trend fields are null/[] until a report exists; silence stats are
    # reduced worker-side so the web never re-derives them per render.
    db = FakeDatabase()
    package = _ready_package(db)
    scored = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    db.save_report(scored.id, _stored_report(scored.id))
    planned = db.create_session(package.id, 2, plan_baseline_session(package.rubric))
    client = _session_client(monkeypatch, db)

    response = client.get(
        f"/api/packages/{package.id}/progress", headers=API_HEADERS
    )

    assert response.status_code == 200
    assert response.json() == {
        "package_id": package.id,
        "total_sessions": 6,
        "is_trial": False,
        "paid_at": None,
        "comped_at": None,
        "expires_at": None,
        "sessions": [
            {
                "session_id": scored.id,
                "index": 1,
                "created_at": scored.created_at,
                "status": "scored",
                "verdict": "approaching",
                "overall": 3.4,
                "dimension_scores": [
                    {"dimension_key": "structured-answers", "score": 3.4},
                    {"dimension_key": "pacing-control", "score": 3.8},
                ],
                "wpm_overall": 141.0,
                "filler_rate_per_min": 1.2,
                "avg_response_latency_s": 1.3,
                "silence": {"count": 2, "total_s": 6.5, "longest_s": 4.0},
                "gaps": ["Answers stay at the summary level."],
            },
            {
                "session_id": planned.id,
                "index": 2,
                "created_at": planned.created_at,
                "status": "planned",
                "verdict": None,
                "overall": None,
                "dimension_scores": [],
                "wpm_overall": None,
                "filler_rate_per_min": None,
                "avg_response_latency_s": None,
                "silence": None,
                "gaps": [],
            },
        ],
    }


def test_progress_with_zero_silence_events_reduces_to_zeros(monkeypatch):
    # max() over an empty event list must reduce to 0.0, never raise.
    db = FakeDatabase()
    package = _ready_package(db)
    session = db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    report = _stored_report(session.id)
    report = report.model_copy(update={
        "delivery_metrics": report.delivery_metrics.model_copy(
            update={"silence_events": []})
    })
    db.save_report(session.id, report)
    client = _session_client(monkeypatch, db)

    response = client.get(
        f"/api/packages/{package.id}/progress", headers=API_HEADERS
    )

    (entry,) = response.json()["sessions"]
    assert entry["silence"] == {"count": 0, "total_s": 0.0, "longest_s": 0.0}


def test_list_user_packages_newest_first_with_usage(monkeypatch):
    db = FakeDatabase()
    older = _ready_package(db, total_sessions=2, user_id="user-1")
    session = db.create_session(older.id, 1, plan_baseline_session(older.rubric))
    db.set_session_status(session.id, "scored")
    newer = _ready_package(db, total_sessions=4, user_id="user-1")
    _ready_package(db, user_id="another-user")
    client = _session_client(monkeypatch, db)

    response = client.get("/api/users/user-1/packages", headers=API_HEADERS)

    assert response.status_code == 200
    assert response.json() == {"packages": [
        {"id": newer.id, "access_token": newer.access_token, "status": "ready",
         "user_id": "user-1", "total_sessions": 4, "sessions_used": 0,
         "role_title": "Forward Deployed Product Manager",
         "company": "ExampleCo", "jd_url": None, "is_trial": False, "paid_at": None,
         "comped_at": None,
         "expires_at": None},
        {"id": older.id, "access_token": older.access_token, "status": "ready",
         "user_id": "user-1", "total_sessions": 2, "sessions_used": 1,
         "role_title": "Forward Deployed Product Manager",
         "company": "ExampleCo", "jd_url": None, "is_trial": False, "paid_at": None,
         "comped_at": None,
         "expires_at": None},
    ]}


def test_list_user_packages_empty_and_requires_auth(monkeypatch):
    db = FakeDatabase()
    client = _session_client(monkeypatch, db)

    empty = client.get("/api/users/unknown/packages", headers=API_HEADERS)
    unauthorized = client.get("/api/users/unknown/packages")

    assert empty.status_code == 200
    assert empty.json() == {"packages": []}
    assert unauthorized.status_code == 401


def test_sessions_list_exposes_created_at(monkeypatch):
    """The dashboard renders session dates from created_at (W-B handback:
    the web types it optional, so a missing field would silently drop every
    date rather than fail — this pins the contract instead)."""
    db = FakeDatabase()
    package = _ready_package(db)
    db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    client = _session_client(monkeypatch, db)

    response = client.get(
        f"/api/packages/{package.id}/sessions", headers=API_HEADERS
    )

    assert response.status_code == 200
    (item,) = response.json()["sessions"]
    assert item["created_at"] is not None
