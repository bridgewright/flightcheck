"""Deterministic DSP delivery metrics: no LLM in this channel.

Every number here is reproducible from the audio samples and the
transcript segmentation alone. The delivery judge (Task 10) layers
interpretation on top of these numbers and is flagged whenever it
contradicts them, so this module is the delivery channel's ground truth.
"""
from __future__ import annotations

import math
import re
from collections.abc import Sequence
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from scorer.config import load_product_config
from scorer.schemas import DeliveryMetrics, SilenceEvent, TranscriptSegment

FILLER_LEXICON: tuple[str, ...] = tuple(load_product_config().delivery.fillers)

_BUCKET_S = 60.0
_RMS_FRAME_LENGTH = 2048
_RMS_HOP_LENGTH = 512
_SILENCE_RMS_RATIO = 0.02
_MIN_SILENCE_S = 1.0
_PYIN_FMIN_HZ = 65.0
_PYIN_FMAX_HZ = 400.0
_VOICED_ABS_FLOOR = 1e-6


def _load_mono(audio_path: Path) -> tuple[np.ndarray, int]:
    """Read a wav as float32 mono (channels averaged, native rate kept)."""
    data, sr = sf.read(audio_path, dtype="float32", always_2d=True)
    return data.mean(axis=1), int(sr)


def _wpm_timeline(
    candidate_segments: list[TranscriptSegment], duration_s: float
) -> list[float]:
    """Per-minute speaking-rate buckets across the whole session.

    A segment's words spread uniformly over its duration, so a segment
    crossing a bucket boundary contributes to both buckets proportionally.
    A bucket's value is words per minute of candidate SPEECH inside it
    (words in bucket / candidate speaking fraction of the bucket); buckets
    where the candidate never speaks read 0.0.
    """
    n_buckets = max(1, math.ceil(duration_s / _BUCKET_S))
    words = [0.0] * n_buckets
    speaking_s = [0.0] * n_buckets
    for seg in candidate_segments:
        seg_duration = seg.end_s - seg.start_s
        if seg_duration <= 0:
            continue
        seg_words = len(seg.text.split())
        for bucket in range(n_buckets):
            bucket_lo = bucket * _BUCKET_S
            bucket_hi = bucket_lo + _BUCKET_S
            overlap = min(seg.end_s, bucket_hi) - max(seg.start_s, bucket_lo)
            if overlap <= 0:
                continue
            words[bucket] += seg_words * overlap / seg_duration
            speaking_s[bucket] += overlap
    timeline: list[float] = []
    for bucket in range(n_buckets):
        fraction = speaking_s[bucket] / _BUCKET_S
        timeline.append(words[bucket] / fraction if fraction > 0 else 0.0)
    return timeline


def _candidate_windows(
    segments: list[TranscriptSegment], duration_s: float
) -> list[tuple[float, float]]:
    """Spans from an interviewer segment end to the next interviewer start.

    Silence inside these windows belongs to the candidate (thinking
    pauses, trailing hesitation). Silence anywhere else -- before the
    first question, or while the interviewer holds the floor -- is not
    the candidate's and never becomes a SilenceEvent.
    """
    interviewer = sorted(
        (s for s in segments if s.speaker == "interviewer"),
        key=lambda s: s.start_s,
    )
    windows: list[tuple[float, float]] = []
    for i, seg in enumerate(interviewer):
        if i + 1 < len(interviewer):
            window_end = interviewer[i + 1].start_s
        else:
            window_end = duration_s
        if window_end > seg.end_s:
            windows.append((seg.end_s, window_end))
    return windows


def _silence_events(
    mono: np.ndarray,
    sr: int,
    segments: list[TranscriptSegment],
    duration_s: float,
) -> list[SilenceEvent]:
    """Contiguous low-RMS runs >= 1.0 s inside candidate answer windows."""
    windows = _candidate_windows(segments, duration_s)
    if not windows:
        return []
    rms = librosa.feature.rms(
        y=mono, frame_length=_RMS_FRAME_LENGTH, hop_length=_RMS_HOP_LENGTH
    )[0]
    peak = float(rms.max())
    if peak <= 0.0:
        return []  # dead recording: no reference level, no events
    silent = rms < _SILENCE_RMS_RATIO * peak
    frame_s = _RMS_HOP_LENGTH / sr
    events: list[SilenceEvent] = []
    run_start: int | None = None
    # The appended False sentinel closes a run that reaches the last frame.
    for index, is_silent in enumerate([*silent, False]):
        if is_silent and run_start is None:
            run_start = index
        elif not is_silent and run_start is not None:
            run_lo = run_start * frame_s
            run_hi = index * frame_s
            for window_lo, window_hi in windows:
                lo = max(run_lo, window_lo)
                hi = min(run_hi, window_hi)
                if hi - lo >= _MIN_SILENCE_S:
                    events.append(SilenceEvent(start_s=lo, duration_s=hi - lo))
            run_start = None
    return sorted(events, key=lambda event: event.start_s)


def count_filler_matches(text: str, lexicon: Sequence[str]) -> int:
    """Word-boundary filler matches over lowercased text.

    Whitespace is normalized first so multi-word fillers ("you know")
    match as whole phrases even across line breaks in the transcript.
    """
    normalized = " ".join(text.lower().split())
    total = 0
    for filler in lexicon:
        pattern = r"\b" + re.escape(filler.lower()) + r"\b"
        total += len(re.findall(pattern, normalized))
    return total


def _f0_variance(
    mono: np.ndarray, sr: int, candidate_segments: list[TranscriptSegment]
) -> float | None:
    """Variance of voiced pyin f0 over candidate spans; None if unvoiced."""
    spans: list[np.ndarray] = []
    for seg in candidate_segments:
        lo = max(0, int(seg.start_s * sr))
        hi = min(len(mono), int(seg.end_s * sr))
        if hi > lo:
            spans.append(mono[lo:hi])
    if not spans:
        return None
    candidate_audio = np.concatenate(spans)
    if candidate_audio.size < _RMS_FRAME_LENGTH:
        return None
    if not np.any(np.abs(candidate_audio) > _VOICED_ABS_FLOOR):
        return None  # digital silence: nothing is voiced, skip pyin
    f0, _voiced_flag, _voiced_probs = librosa.pyin(
        candidate_audio, fmin=_PYIN_FMIN_HZ, fmax=_PYIN_FMAX_HZ, sr=sr
    )
    voiced = f0[~np.isnan(f0)]
    if voiced.size == 0:
        return None
    return float(np.var(voiced))


def _avg_response_latency(segments: list[TranscriptSegment]) -> float | None:
    """Mean interviewer-end -> candidate-start gap over direct transitions."""
    ordered = sorted(segments, key=lambda seg: seg.start_s)
    latencies = [
        following.start_s - prior.end_s
        for prior, following in zip(ordered, ordered[1:])  # noqa: RUF007 — pairwise adds a dep for one zip
        if prior.speaker == "interviewer" and following.speaker == "candidate"
    ]
    if not latencies:
        return None
    return sum(latencies) / len(latencies)


def compute_delivery_metrics(
    audio_path: Path, segments: list[TranscriptSegment]
) -> DeliveryMetrics:
    """Deterministic delivery metrics for one session recording."""
    mono, sr = _load_mono(audio_path)
    duration_s = len(mono) / sr
    candidate_segments = [s for s in segments if s.speaker == "candidate"]
    speaking_min = sum(s.end_s - s.start_s for s in candidate_segments) / 60.0
    total_words = sum(len(s.text.split()) for s in candidate_segments)
    candidate_text = " ".join(s.text for s in candidate_segments)
    filler_count = count_filler_matches(candidate_text, FILLER_LEXICON)
    return DeliveryMetrics(
        wpm_overall=total_words / speaking_min if speaking_min > 0 else 0.0,
        wpm_timeline=_wpm_timeline(candidate_segments, duration_s),
        silence_events=_silence_events(mono, sr, segments, duration_s),
        filler_count=filler_count,
        filler_rate_per_min=(
            filler_count / speaking_min if speaking_min > 0 else 0.0
        ),
        f0_variance=_f0_variance(mono, sr, candidate_segments),
        avg_response_latency_s=_avg_response_latency(segments),
    )
