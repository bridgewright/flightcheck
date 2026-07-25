"""Tests for scorer.delivery.dsp -- deterministic delivery metrics."""
import numpy as np
import pytest
import soundfile as sf

from scorer.config import load_product_config
from scorer.delivery import dsp
from scorer.delivery.dsp import (
    FILLER_LEXICON,
    compute_delivery_metrics,
    count_filler_matches,
)
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


def test_filler_lexicon_comes_from_product_config():
    delivery = load_product_config().delivery
    assert FILLER_LEXICON == tuple(delivery.fillers)
    assert "um" in FILLER_LEXICON
    assert "uh" in FILLER_LEXICON
    assert "you know" in FILLER_LEXICON


def test_count_filler_matches_word_boundaries_and_phrases():
    text = (
        "Um, I think, um, we shipped it and, uh, you know, it worked. "
        "Umbrella sales grew, unlike our, you know, forecast."
    )
    # um x2 + uh x1 + "you know" x2 = 5.
    assert count_filler_matches(text, ("um", "uh", "you know")) == 5
    assert count_filler_matches(text, ()) == 0
    # "Umbrella" must not count as "um": matches are word-bounded.
    assert count_filler_matches("Umbrella umpire umami", ("um",)) == 0


def test_filler_metrics_use_module_lexicon(tmp_path, monkeypatch):
    monkeypatch.setattr(dsp, "FILLER_LEXICON", ("um", "uh", "you know"))
    wav = tmp_path / "session.wav"
    _write_silence_wav(wav, 30.0)
    segments = [
        _seg(
            0.0,
            30.0,
            "candidate",
            "Um, so we, uh, shipped the beta and, you know, it worked, um.",
        )
    ]

    metrics = compute_delivery_metrics(wav, segments)

    # um x2 + uh x1 + "you know" x1 = 4 fillers over 0.5 min of speech.
    assert metrics.filler_count == 4
    assert metrics.filler_rate_per_min == pytest.approx(8.0)


TONE_SPANS = [
    (0.0, 2.0),    # interviewer speaking
    (3.5, 5.0),    # interviewer speaking (after a 1.5 s mid-question pause)
    (7.0, 9.0),    # candidate speaking
    (9.5, 11.0),   # candidate speaking (after a 0.5 s mid-answer pause)
    (14.0, 17.0),  # interviewer speaking
    (18.5, 20.0),  # candidate speaking
]

SESSION_SEGMENTS = [
    _seg(0.0, 5.0, "interviewer", "Walk me through a launch you led."),
    _seg(7.0, 11.0, "candidate", "I led the beta launch of our tool."),
    _seg(14.0, 17.0, "interviewer", "What went wrong along the way?"),
    _seg(18.5, 20.0, "candidate", "We slipped one week on rollout."),
]


def _write_tone_wav(path, duration_s: float, tone_spans) -> None:
    """16 kHz mono wav: 220 Hz sine bursts over digital silence."""
    n_samples = int(duration_s * SR)
    samples = np.zeros(n_samples, dtype=np.float32)
    t = np.arange(n_samples) / SR
    for span_start, span_end in tone_spans:
        lo = int(span_start * SR)
        hi = int(span_end * SR)
        burst = 0.5 * np.sin(2.0 * np.pi * 220.0 * t[lo:hi])
        samples[lo:hi] = burst.astype(np.float32)
    sf.write(path, samples, SR)


def test_silence_events_only_inside_candidate_answer_windows(tmp_path):
    wav = tmp_path / "session.wav"
    _write_tone_wav(wav, 20.0, TONE_SPANS)

    metrics = compute_delivery_metrics(wav, SESSION_SEGMENTS)
    events = metrics.silence_events

    # Expected events: (5.0, 2.0) thinking pause before the first answer,
    # (11.0, 3.0) gap after the answer until the next question, (17.0,
    # 1.5) thinking pause before the last answer. Excluded: the
    # interviewer's own 1.5 s pause at 2.0 s (outside every answer
    # window) and the candidate's 0.5 s mid-answer pause at 9.0 s (under
    # the 1.0 s floor). Centered RMS frames smear tone edges by ~0.064 s
    # per side, hence the tolerances.
    assert len(events) == 3
    starts = [event.start_s for event in events]
    durations = [event.duration_s for event in events]
    assert starts == pytest.approx([5.0, 11.0, 17.0], abs=0.15)
    assert durations == pytest.approx([2.0, 3.0, 1.5], abs=0.3)
    assert all(event.duration_s >= 1.0 for event in events)
    assert all(event.start_s > 4.0 for event in events)


def test_f0_variance_present_for_voiced_candidate_audio(tmp_path):
    wav = tmp_path / "session.wav"
    _write_tone_wav(wav, 20.0, TONE_SPANS)

    metrics = compute_delivery_metrics(wav, SESSION_SEGMENTS)

    # Candidate spans carry a 220 Hz tone (inside pyin's 65-400 Hz
    # range): pyin must find voiced frames, and a near-constant pitch
    # keeps the variance small but defined.
    assert metrics.f0_variance is not None
    assert metrics.f0_variance >= 0.0


def test_f0_variance_none_for_pure_silence(tmp_path):
    wav = tmp_path / "session.wav"
    _write_silence_wav(wav, 15.0)
    segments = [
        _seg(0.0, 1.5, "interviewer", "Anything you want to add?"),
        _seg(2.0, 8.0, "candidate", "Nothing that made a sound."),
    ]

    metrics = compute_delivery_metrics(wav, segments)

    assert metrics.f0_variance is None
    # Zero peak energy means no silence reference level either
    # (a dead recording is an upload problem, not a delivery signal).
    assert metrics.silence_events == []
