"""F-48 + F-03b wired end to end: authored fields land in the STORED report.

score_session runs against the fake layers with content-judge replies that
carry key_span and the strengths/weaknesses lists; the row the database
stores must carry them, and the delivery dimensions (whose judge does not
author these fields) must read back the defaults on the same report.
"""
import io
import json

import numpy as np
import pytest
import soundfile as sf

from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.pipeline import score_session
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)
from scorer.sessionplan.planner import plan_baseline_session

JD_TEXT = "We are hiring a Senior Product Analyst to own growth analytics."

SEGMENTS_JSON = json.dumps({"segments": [
    {"start_s": 0.0, "end_s": 1.8, "speaker": "interviewer",
     "text": "Walk me through a project you led end to end."},
    {"start_s": 3.6, "end_s": 7.6, "speaker": "candidate",
     "text": "Um, I led the churn dashboard rollout and we cut churn by 12 percent."},
]})

_RATIONALE = (
    "One clear arc from ownership to outcome. "
    "The second half of the answer stays thin on specifics."
)
_KEY_SPAN = "The second half of the answer stays thin on specifics."
_STRENGTHS = ["Named the outcome and the number without prompting."]
_WEAKNESSES = ["No trade-off was weighed before the recommendation."]

# Six judge replies (2 content dims x 3 samples, exactly): the focused
# dimension calls run concurrently and pop the ordered script in no fixed
# order, so every reply carries both dimensions' scores and is valid for
# whichever call pops it. structured-answers carries the authored fields;
# quantified-impact answers in the old shape (defaults).
CONTENT_SCORES_JSONS = [json.dumps({"scores": [
    {"dimension_key": "structured-answers", "score": 4.0,
     "evidence_quotes": ["I led the churn dashboard rollout"],
     "rationale": _RATIONALE,
     "key_span": _KEY_SPAN,
     "strengths": _STRENGTHS,
     "weaknesses": _WEAKNESSES},
    {"dimension_key": "quantified-impact", "score": 4.5,
     "evidence_quotes": ["we cut churn by 12 percent"],
     "rationale": "Quantified outcome stated directly."},
]})] * 6

DELIVERY_JUDGE_JSON = json.dumps({
    "scores": [
        {"dimension_key": "pacing-control", "score": 4.0,
         "evidence_quotes": ["03:36-07:36 steady pace"],
         "rationale": "Pace stays steady across the answer window."},
    ],
    "observations": [],
})


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}."),
        ],
        signals=[f"{name}: named specifics"],
        citations=[
            SourceCitation(
                url="https://example.com/guide",
                title="Example guide",
                snippet=f"Interviewers probe {lowered}.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.4),
            _dim("quantified-impact", "Quantified impact", "content", 0.3),
            _dim("pacing-control", "Pacing control", "delivery", 0.3),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric for the authored-fields pipeline test.",
    )


def _wav_bytes(duration_s: float = 8.0, sample_rate: int = 16000) -> bytes:
    t = np.linspace(0.0, duration_s, int(sample_rate * duration_s), endpoint=False)
    audio = 0.3 * np.sin(2 * np.pi * 220.0 * t)
    audio[int(1.8 * sample_rate):int(3.6 * sample_rate)] = 0.0
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _isolated_corpus_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def test_authored_fields_land_in_the_stored_report(permissive_eligibility):
    db = FakeDatabase()
    package = db.create_package(JD_TEXT, None)
    db.set_package_rubric(package.id, _make_rubric(), status="ready")
    session = db.create_session(
        package.id, 1, plan_baseline_session(_make_rubric())
    )
    db.set_session_status(
        session.id, "planned", audio_path="packages/pkg-1/session-1.wav"
    )
    storage = FakeStorage(
        recordings={"packages/pkg-1/session-1.wav": _wav_bytes()}
    )
    fake = FakeGenAI([SEGMENTS_JSON, *CONTENT_SCORES_JSONS, DELIVERY_JUDGE_JSON])

    score_session(session.id, db, storage, fake)

    stored = db.get_session(session.id)
    assert stored.status == "scored"
    by_key = {s.dimension_key: s for s in stored.report.dimension_scores}
    authored = by_key["structured-answers"]
    assert authored.key_span == _KEY_SPAN
    assert authored.key_span in authored.rationale
    assert authored.strengths == _STRENGTHS
    assert authored.weaknesses == _WEAKNESSES
    # Old-shape judge replies on the same report read back the defaults.
    for key in ("quantified-impact", "pacing-control"):
        assert by_key[key].key_span is None
        assert by_key[key].strengths == []
        assert by_key[key].weaknesses == []
