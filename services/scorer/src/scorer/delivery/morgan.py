"""Deterministic Morgan-side delivery and conversational metrics."""
from __future__ import annotations

import hashlib
from itertools import pairwise
from pathlib import Path

import numpy as np
import soundfile as sf
from pydantic import BaseModel, ConfigDict

from scorer.delivery.dsp import compute_delivery_metrics
from scorer.schemas import TranscriptSegment


class TurnStats(BaseModel):
    model_config = ConfigDict(extra="forbid")

    turn_count: int
    turn_length_mean_s: float
    turn_length_p50_s: float
    turn_length_max_s: float
    questions_per_turn_mean: float
    multi_question_turn_count: int


class ResponseLatencyStats(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mean: float
    p90: float


class MorganMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    talk_time_ratio: float
    morgan_speaking_s: float
    candidate_speaking_s: float
    turn_count: int
    turn_length_mean_s: float
    turn_length_p50_s: float
    turn_length_max_s: float
    questions_per_turn_mean: float
    multi_question_turn_count: int
    morgan_interruption_count: int
    overlap_total_s: float
    response_latency_s: ResponseLatencyStats
    morgan_wpm_overall: float
    morgan_filler_rate_per_min: float
    morgan_f0_variance: float | None


class MorganMetricsDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    source: str
    audio_sha256: str
    duration_s: float
    segments_path: str
    metrics: MorganMetrics


def invert_speakers(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    """Return copies with interviewer and candidate labels swapped."""
    return [
        segment.model_copy(
            update={
                "speaker": (
                    "candidate" if segment.speaker == "interviewer" else "interviewer"
                )
            }
        )
        for segment in segments
    ]


def _speaking_seconds(segments: list[TranscriptSegment], speaker: str) -> float:
    return sum(
        max(0.0, segment.end_s - segment.start_s)
        for segment in segments
        if segment.speaker == speaker
    )


def talk_time_ratio(segments: list[TranscriptSegment]) -> float:
    """Morgan speaking time divided by all labelled speaking time."""
    morgan_s = _speaking_seconds(segments, "interviewer")
    total_s = morgan_s + _speaking_seconds(segments, "candidate")
    return morgan_s / total_s if total_s else 0.0


def interviewer_turns(
    segments: list[TranscriptSegment],
) -> list[list[TranscriptSegment]]:
    """Return maximal interviewer runs, ordered by segment start time."""
    turns: list[list[TranscriptSegment]] = []
    current: list[TranscriptSegment] = []
    for segment in sorted(segments, key=lambda item: item.start_s):
        if segment.speaker == "interviewer":
            current.append(segment)
        elif current:
            turns.append(current)
            current = []
    if current:
        turns.append(current)
    return turns


def turn_stats(segments: list[TranscriptSegment]) -> TurnStats:
    """Summarize Morgan turn duration and question density."""
    turns = interviewer_turns(segments)
    if not turns:
        return TurnStats(
            turn_count=0,
            turn_length_mean_s=0.0,
            turn_length_p50_s=0.0,
            turn_length_max_s=0.0,
            questions_per_turn_mean=0.0,
            multi_question_turn_count=0,
        )
    durations = [turn[-1].end_s - turn[0].start_s for turn in turns]
    question_counts = [" ".join(segment.text for segment in turn).count("?") for turn in turns]
    return TurnStats(
        turn_count=len(turns),
        turn_length_mean_s=float(np.mean(durations)),
        turn_length_p50_s=float(np.percentile(durations, 50)),
        turn_length_max_s=max(durations),
        questions_per_turn_mean=float(np.mean(question_counts)),
        multi_question_turn_count=sum(count >= 2 for count in question_counts),
    )


def morgan_interruptions(
    segments: list[TranscriptSegment], min_overlap_s: float = 0.3
) -> tuple[int, float]:
    """Count Morgan starts inside candidate speech, and total double-talk.

    The two numbers answer different questions and deliberately do not
    filter each other. The COUNT is Morgan's fault: an interviewer segment
    beginning strictly inside a candidate span, over a floor that discards
    transcript timestamp jitter. The TOTAL is every overlapping
    interviewer x candidate second whoever started it -- with
    `interrupt_response: false` a candidate talking over Morgan is the
    common shape, and it is the acoustic-echo diagnostic the bar wants
    (bar.md, "keeps out of the candidate's way"), so scoping the total to
    interruptions would report 0.0 for exactly the sessions worth reading.
    """
    interviewers = [segment for segment in segments if segment.speaker == "interviewer"]
    candidates = [segment for segment in segments if segment.speaker == "candidate"]
    interrupted: set[int] = set()
    total_overlap_s = 0.0
    for index, interviewer in enumerate(interviewers):
        for candidate in candidates:
            overlap_s = min(interviewer.end_s, candidate.end_s) - max(
                interviewer.start_s, candidate.start_s
            )
            if overlap_s <= 0:
                continue
            total_overlap_s += overlap_s
            started_inside = candidate.start_s < interviewer.start_s < candidate.end_s
            if started_inside and overlap_s + 1e-9 >= min_overlap_s:
                interrupted.add(index)
    return len(interrupted), total_overlap_s


def morgan_response_latencies(segments: list[TranscriptSegment]) -> list[float]:
    """Candidate-end to next Morgan-start gaps over direct transitions."""
    ordered = sorted(segments, key=lambda segment: segment.start_s)
    return [
        following.start_s - prior.end_s
        for prior, following in pairwise(ordered)
        if prior.speaker == "candidate"
        and following.speaker == "interviewer"
        and following.start_s - prior.end_s >= 0
    ]


def compute_morgan_metrics(
    audio_path: Path, segments: list[TranscriptSegment]
) -> MorganMetricsDoc:
    """Compute the complete transcript-free metrics document for one WAV."""
    native = compute_delivery_metrics(audio_path, invert_speakers(segments))
    stats = turn_stats(segments)
    interruption_count, overlap_s = morgan_interruptions(segments)
    latencies = morgan_response_latencies(segments)
    latency = ResponseLatencyStats(
        mean=float(np.mean(latencies)) if latencies else 0.0,
        p90=float(np.percentile(latencies, 90)) if latencies else 0.0,
    )
    morgan_s = _speaking_seconds(segments, "interviewer")
    candidate_s = _speaking_seconds(segments, "candidate")
    return MorganMetricsDoc(
        case_id=audio_path.stem,
        source="morgan",
        audio_sha256=hashlib.sha256(audio_path.read_bytes()).hexdigest(),
        duration_s=float(sf.info(audio_path).duration),
        segments_path="",
        metrics=MorganMetrics(
            talk_time_ratio=talk_time_ratio(segments),
            morgan_speaking_s=morgan_s,
            candidate_speaking_s=candidate_s,
            **stats.model_dump(),
            morgan_interruption_count=interruption_count,
            overlap_total_s=overlap_s,
            response_latency_s=latency,
            morgan_wpm_overall=native.wpm_overall,
            morgan_filler_rate_per_min=native.filler_rate_per_min,
            morgan_f0_variance=native.f0_variance,
        ),
    )
