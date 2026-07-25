"""Tests for scorer.api.pipeline -- compile and scoring pipelines (offline)."""
import io
import json

import numpy as np
import pytest
import soundfile as sf

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.pipeline import compile_package, score_session
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
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

CONTENT_SCORES_JSON = json.dumps({"scores": [
    {"dimension_key": "structured-answers", "score": 4.0,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": "One clear arc from ownership to outcome, near the score-5 anchor."},
    {"dimension_key": "quantified-impact", "score": 4.5,
     "evidence_quotes": ["we cut churn by 12 percent"],
     "rationale": "Quantified outcome stated directly, matching the score-5 anchor."},
    {"dimension_key": "role-knowledge", "score": 3.5,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": "One concrete example with thin surrounding detail."},
]})

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


def test_score_session_saves_scored_report():
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/session-1.wav")
    storage = FakeStorage(recordings={"packages/pkg-1/session-1.wav": _wav_bytes()})
    fake = FakeGenAI([SEGMENTS_JSON, CONTENT_SCORES_JSON, DELIVERY_JUDGE_JSON])

    report = score_session(session.id, db, storage, fake)

    assert report.session_id == session.id
    assert report.verdict == "ready"          # 0.2 * (4.0+4.5+3.5+4.0+4.0) = 4.0
    assert report.overall_score == 4.0
    assert len(report.dimension_scores) == 5  # both channels merged
    stored = db.get_session(session.id)
    assert stored.status == "scored"
    assert stored.report is not None
    assert stored.report.verdict == "ready"


def test_score_session_records_failure_and_reraises():
    db = FakeDatabase()
    session = _seed_scorable_session(db, "packages/pkg-1/missing.wav")

    # Empty storage: download_recording raises KeyError before any LLM call.
    with pytest.raises(KeyError):
        score_session(session.id, db, FakeStorage(), FakeGenAI([]))

    stored = db.get_session(session.id)
    assert stored.status == "failed"
    assert stored.report is None
