"""Tests for scorer.delivery.dsp -- deterministic delivery metrics."""
import numpy as np
import pytest
import soundfile as sf

from scorer.delivery.dsp import compute_delivery_metrics
from scorer.schemas import TranscriptSegment

SR = 16000


def _write_silence_wav(path, duration_s: float) -> None:
    sf.write(path, np.zeros(int(duration_s * SR), dtype=np.float32), SR)


def _seg(start_s: float, end_s: float, speaker: str, text: str) -> TranscriptSegment:
    return TranscriptSegment(
        start_s=start_s, end_s=end_s, speaker=speaker, text=text
    )


def test_wpm_overall_and_timeline_math(tmp_path):
    wav = tmp_path / "session.wav"
    _write_silence_wav(wav, 125.0)
    segments = [
        _seg(0.0, 10.0, "candidate", " ".join(["word"] * 20)),
        _seg(70.0, 80.0, "candidate", " ".join(["word"] * 30)),
    ]

    metrics = compute_delivery_metrics(wav, segments)

    # 50 words over 20 s of candidate speech -> 150 wpm overall.
    assert metrics.wpm_overall == pytest.approx(150.0)
    # Bucket 0: 20 words / (10 s / 60 s) = 120. Bucket 1: 30 / (10/60) =
    # 180. Bucket 2 (120-125 s) has no candidate speech -> 0.0.
    assert metrics.wpm_timeline == pytest.approx([120.0, 180.0, 0.0])


def test_avg_response_latency_over_transitions(tmp_path):
    wav = tmp_path / "session.wav"
    _write_silence_wav(wav, 12.0)
    segments = [
        _seg(0.0, 2.0, "interviewer", "Tell me about a project you led."),
        _seg(3.0, 5.0, "candidate", "I led the churn dashboard rollout."),
        _seg(6.0, 8.0, "interviewer", "What was your specific role?"),
        _seg(8.5, 10.0, "candidate", "I owned the metric definitions."),
    ]

    metrics = compute_delivery_metrics(wav, segments)

    # Transitions: 3.0 - 2.0 = 1.0 and 8.5 - 8.0 = 0.5 -> mean 0.75.
    assert metrics.avg_response_latency_s == pytest.approx(0.75)


def test_latency_none_without_interviewer_to_candidate_transition(tmp_path):
    wav = tmp_path / "session.wav"
    _write_silence_wav(wav, 8.0)
    segments = [
        _seg(1.0, 3.0, "candidate", "Talking to myself first."),
        _seg(4.0, 6.0, "candidate", "Still just me."),
    ]

    metrics = compute_delivery_metrics(wav, segments)

    assert metrics.avg_response_latency_s is None


def test_no_candidate_speech_yields_zero_metrics(tmp_path):
    wav = tmp_path / "session.wav"
    _write_silence_wav(wav, 10.0)
    segments = [
        _seg(0.0, 9.0, "interviewer", "A question with no answer at all?")
    ]

    metrics = compute_delivery_metrics(wav, segments)

    assert metrics.wpm_overall == 0.0
    assert metrics.wpm_timeline == [0.0]
    assert metrics.filler_count == 0
    assert metrics.filler_rate_per_min == 0.0
    assert metrics.silence_events == []
    assert metrics.f0_variance is None
    assert metrics.avg_response_latency_s is None
