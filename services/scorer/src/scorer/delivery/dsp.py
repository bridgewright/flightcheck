"""Deterministic DSP delivery metrics (this cycle: pacing and latency).

No LLM touches this channel: every number is reproducible from the audio
samples and the transcript segmentation alone. The delivery judge (Task
10) layers interpretation on top of these numbers and is flagged whenever
it contradicts them, so this module is the delivery channel's ground
truth.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import soundfile as sf

from scorer.schemas import DeliveryMetrics, TranscriptSegment

_BUCKET_S = 60.0


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
    return DeliveryMetrics(
        wpm_overall=total_words / speaking_min if speaking_min > 0 else 0.0,
        wpm_timeline=_wpm_timeline(candidate_segments, duration_s),
        silence_events=[],  # grown in a later cycle of this task
        filler_count=0,  # grown in a later cycle of this task
        filler_rate_per_min=0.0,  # grown in a later cycle of this task
        f0_variance=None,  # grown in a later cycle of this task
        avg_response_latency_s=_avg_response_latency(segments),
    )
