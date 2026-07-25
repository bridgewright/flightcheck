import json

import numpy as np
import pytest
import soundfile as sf

from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.delivery.judge import DeliveryJudgeDoc, DeliveryJudgeError, judge_delivery
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    RubricDimension,
    SilenceEvent,
    SourceCitation,
)


def _dim(key: str, name: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel="delivery",
        anchors=[
            BarsAnchor(score=1, behavior=f"Weak {lowered}: frequent breakdowns under pressure."),
            BarsAnchor(score=3, behavior=f"Uneven {lowered}: recovers, with audible effort."),
            BarsAnchor(score=5, behavior=f"Strong {lowered}: steady and controlled throughout."),
        ],
        signals=[
            f"{name}: steadiness across turns",
            f"{name}: recovery after the pressure probe",
        ],
        citations=[
            SourceCitation(
                url="https://example.com/delivery-guide",
                title="Example delivery guide",
                snippet=f"Interviewers listen for {lowered} across the whole session.",
            )
        ],
    )


def _delivery_dims() -> list[RubricDimension]:
    return [
        _dim("pacing-control", "Pacing control", 0.2),
        _dim("composure", "Composure", 0.2),
    ]


def _write_wav(path, duration_s: float = 30.0) -> None:
    sr = 16000
    t = np.linspace(0.0, duration_s, int(sr * duration_s), endpoint=False)
    audio = 0.2 * np.sin(2 * np.pi * 220.0 * t)
    audio[int(sr * 10.0) : int(sr * 14.0)] = 0.0  # a 4 s silence gap mid-file
    sf.write(path, audio.astype(np.float32), sr)


def _metrics() -> DeliveryMetrics:
    return DeliveryMetrics(
        wpm_overall=128.0,
        wpm_timeline=[141.0, 122.0],
        silence_events=[SilenceEvent(start_s=10.0, duration_s=4.0)],
        filler_count=9,
        filler_rate_per_min=3.2,
        f0_variance=812.5,
        avg_response_latency_s=1.4,
    )


def _delivery_score(key: str, score: float, quotes: list[str], rationale: str) -> dict:
    return {
        "dimension_key": key,
        "score": score,
        "evidence_quotes": quotes,
        "rationale": rationale,
    }


def _observation(at_s: float, kind: str, note: str, conflicts: bool = False) -> dict:
    return {"at_s": at_s, "kind": kind, "note": note, "conflicts_with_dsp": conflicts}


def _happy_doc() -> dict:
    return {
        "scores": [
            _delivery_score(
                "pacing-control",
                3.5,
                ["[00:10] a 4.0s silence, then pace resets to a steady rate"],
                "Uneven pacing around the long silence, matching the score-3 anchor.",
            ),
            _delivery_score(
                "composure",
                4.0,
                ["[00:14] voice stays level resuming after the long silence"],
                "Steady tone through the recovery, close to the score-5 anchor.",
            ),
        ],
        "observations": [
            _observation(
                10.0,
                "silence-character",
                "flat, held silence at [00:10] before the answer resumes",
            ),
            _observation(
                14.0,
                "recovery-under-pressure",
                "even syllable timing within two seconds of resuming speech",
            ),
            _observation(
                22.0,
                "filler-burst",
                "audible filler cluster around [00:22] denser than the reported filler rate",
                conflicts=True,
            ),
        ],
    }


def test_happy_path_scores_delivery_dims_and_uploads_audio(tmp_path):
    wav = tmp_path / "session.wav"
    _write_wav(wav)
    dims = _delivery_dims()
    fake = FakeGenAI([json.dumps(_happy_doc())])

    scores, observations = judge_delivery(wav, _metrics(), dims, fake)

    assert [s.dimension_key for s in scores] == ["pacing-control", "composure"]
    assert scores[0].score == 3.5
    assert scores[0].evidence_quotes == [
        "[00:10] a 4.0s silence, then pace resets to a steady rate"
    ]
    assert [o.kind for o in observations] == [
        "silence-character",
        "recovery-under-pressure",
        "filler-burst",
    ]
    assert observations[0].conflicts_with_dsp is False
    assert observations[2].conflicts_with_dsp is True

    # Exactly one upload of the wav; the returned handle rides in contents with the prompt.
    assert fake.files.uploads == [wav]
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["model"] == load_product_config().models.scorer
    assert call["config"]["response_mime_type"] == "application/json"
    assert call["config"]["response_schema"] is DeliveryJudgeDoc

    handle, prompt = call["contents"]
    assert not isinstance(handle, str)  # the upload handle, never a bare path string
    assert isinstance(prompt, str)
    assert "Audio duration: 30.0 seconds." in prompt
    assert "128.0 WPM" in prompt
    assert "141.0, 122.0" in prompt
    assert "4.0s at [00:10]" in prompt
    assert "9 (3.2 per minute)" in prompt
    assert "812.5" in prompt
    assert "1.4s" in prompt
    for dim in dims:
        assert dim.key in prompt
        assert dim.name in prompt
        for signal in dim.signals:
            assert signal in prompt
        for anchor in dim.anchors:
            assert anchor.behavior in prompt
    assert "set conflicts_with_dsp=true" in prompt
    assert '"[04:12]"' in prompt
    assert '"nervous"' in prompt


def test_out_of_range_observations_dropped(tmp_path):
    wav = tmp_path / "session.wav"
    _write_wav(wav)  # duration is exactly 30.0 s
    doc = _happy_doc()
    doc["observations"] = [
        _observation(
            -2.0,
            "hedging-intonation",
            "rising terminal intonation claimed before the audio starts",
        ),
        _observation(
            30.0,
            "trailing-off",
            "final words fade under the exhale at the very end",
        ),
        _observation(
            45.0,
            "hedging-intonation",
            "rising terminal intonation on the closing claim",
        ),
    ]
    fake = FakeGenAI([json.dumps(doc)])

    _, observations = judge_delivery(wav, _metrics(), _delivery_dims(), fake)

    # Only the at_s == duration boundary case survives; -2.0 and 45.0 are out of range.
    assert [o.at_s for o in observations] == [30.0]
    assert observations[0].kind == "trailing-off"


def test_missing_delivery_dimension_raises(tmp_path):
    wav = tmp_path / "session.wav"
    _write_wav(wav)
    doc = _happy_doc()
    doc["scores"] = doc["scores"][:1]  # composure is a delivery dim but absent
    fake = FakeGenAI([json.dumps(doc)])

    with pytest.raises(DeliveryJudgeError, match="composure"):
        judge_delivery(wav, _metrics(), _delivery_dims(), fake)


def test_non_delivery_dimension_scores_dropped(tmp_path):
    wav = tmp_path / "session.wav"
    _write_wav(wav)
    doc = _happy_doc()
    doc["scores"].append(
        _delivery_score(
            "structured-answers",
            2.0,
            ["[00:05] first answer opens without a frame"],
            "Content-channel key that must not leak into delivery output.",
        )
    )
    fake = FakeGenAI([json.dumps(doc)])

    scores, _ = judge_delivery(wav, _metrics(), _delivery_dims(), fake)

    assert {s.dimension_key for s in scores} == {"pacing-control", "composure"}
