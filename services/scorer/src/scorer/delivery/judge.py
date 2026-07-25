"""Delivery judge: scores delivery-channel rubric dimensions from the audio itself.

One file-based Gemini call on the uploaded wav. The prompt carries the DSP
metrics as measured ground truth and each delivery dimension's BARS anchors
verbatim, so the audio-native judge adds character (hedging intonation,
trailing off, what silences sound like) without re-measuring what DSP already
measured. Post-validation in code: observations outside the audio duration are
dropped (duration via soundfile.info), scores for non-delivery keys are
dropped, and a missing delivery dimension raises.
"""
from __future__ import annotations

from pathlib import Path

import soundfile as sf
from pydantic import BaseModel, ConfigDict

from scorer.config import load_product_config
from scorer.schemas import (
    DeliveryMetrics,
    DimensionScore,
    GenAIClientLike,
    RubricDimension,
    TimestampedObservation,
)


class DeliveryJudgeError(Exception):
    """The judge response is unusable (a delivery dimension is missing)."""


class DeliveryJudgeDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scores: list[DimensionScore]
    observations: list[TimestampedObservation]


_RULES = (
    "Judging rules:\n"
    "- Judge DELIVERY only: hedging intonation, trailing off, the character of\n"
    "  silences, pronunciation clarity spans, and composure across the pressure\n"
    "  moment. Never judge the content of the answers.\n"
    "- Score each listed dimension from 1.0 to 5.0. Anchor every score to the BARS\n"
    "  anchor language above. Interpolating between anchors (for example 3.5) is allowed.\n"
    '- evidence_quotes must cite timestamps in [MM:SS] form (for example "[04:12]")\n'
    "  pointing at the audio moments that justify the score.\n"
    "- Every observation carries at_s in seconds from the start of the audio; at_s\n"
    "  must fall within the audio duration stated above.\n"
    '- Observation notes describe observed signals only (for example "rising terminal\n'
    '  intonation on factual claims"). Never claim inner states such as "nervous" or\n'
    '  "anxious".\n'
    "- The DSP numbers above are measured ground truth. If what you hear contradicts\n"
    "  a DSP number, still report what you hear but set conflicts_with_dsp=true on\n"
    "  that observation.\n"
    "- Return a score for every listed dimension, using its exact dimension key."
)


def _fmt_ts(seconds: float) -> str:
    total = int(seconds)
    return f"[{total // 60:02d}:{total % 60:02d}]"


def _metrics_block(metrics: DeliveryMetrics) -> str:
    timeline = ", ".join(f"{wpm:.1f}" for wpm in metrics.wpm_timeline) or "unavailable"
    if metrics.silence_events:
        silences = "; ".join(
            f"{event.duration_s:.1f}s at {_fmt_ts(event.start_s)}"
            for event in metrics.silence_events
        )
    else:
        silences = "none detected"
    if metrics.f0_variance is None:
        f0 = "unavailable (pitch tracking failed)"
    else:
        f0 = f"{metrics.f0_variance:.1f}"
    if metrics.avg_response_latency_s is None:
        latency = "unavailable"
    else:
        latency = f"{metrics.avg_response_latency_s:.1f}s"
    return (
        "DSP metrics (measured ground truth for this audio):\n"
        f"- Overall speaking rate: {metrics.wpm_overall:.1f} WPM (candidate speech only)\n"
        f"- Per-minute WPM timeline: {timeline}\n"
        f"- Silences >= 1.0s: {silences}\n"
        f"- Filler count: {metrics.filler_count} ({metrics.filler_rate_per_min:.1f} per minute)\n"
        f"- Pitch (f0) variance: {f0}\n"
        f"- Average response latency: {latency}"
    )


def _dimension_block(dim: RubricDimension) -> str:
    signals = "\n".join(f"  - {signal}" for signal in dim.signals)
    anchors = "\n".join(f"  score {a.score}: {a.behavior}" for a in dim.anchors)
    return (
        f"Dimension key: {dim.key}\n"
        f"Name: {dim.name}\n"
        f"Signals:\n{signals}\n"
        f"BARS anchors:\n{anchors}"
    )


def _build_prompt(
    delivery_dims: list[RubricDimension],
    metrics: DeliveryMetrics,
    duration_s: float,
) -> str:
    dims = "\n\n".join(_dimension_block(d) for d in delivery_dims)
    return (
        "You are judging the DELIVERY of a mock interview from the attached audio\n"
        "recording of the candidate's session.\n\n"
        f"Audio duration: {duration_s:.1f} seconds.\n\n"
        f"{_metrics_block(metrics)}\n\n"
        f"Delivery dimensions to score:\n\n{dims}\n\n"
        f"{_RULES}"
    )


def judge_delivery(
    audio_path: Path,
    metrics: DeliveryMetrics,
    delivery_dims: list[RubricDimension],
    client: GenAIClientLike,
) -> tuple[list[DimensionScore], list[TimestampedObservation]]:
    duration_s = sf.info(str(audio_path)).duration
    handle = client.files.upload(file=audio_path)
    response = client.models.generate_content(
        model=load_product_config().models.scorer,
        contents=[handle, _build_prompt(delivery_dims, metrics, duration_s)],
        config={
            "response_mime_type": "application/json",
            "response_schema": DeliveryJudgeDoc,
        },
    )
    doc = DeliveryJudgeDoc.model_validate_json(response.text)

    observations = [obs for obs in doc.observations if 0.0 <= obs.at_s <= duration_s]
    delivery_keys = {d.key for d in delivery_dims}
    scores = [s for s in doc.scores if s.dimension_key in delivery_keys]
    missing = delivery_keys - {s.dimension_key for s in scores}
    if missing:
        raise DeliveryJudgeError(
            f"delivery judge response missing dimensions: {sorted(missing)}"
        )
    return scores, observations
