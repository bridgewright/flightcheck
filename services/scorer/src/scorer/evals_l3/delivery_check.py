"""Evals layer 3: delivery discrimination on controlled clips.

Clip convention under evals/suites/delivery_discrimination/clips/ (gitignored,
see clips/README.md): <question>-fluent.wav, <question>-filler.wav,
<question>-hesitant.wav -- three takes of the same answer at different
delivery quality. Two checks per triplet:

1. DSP separability (silence/pace only): fluent must have strictly fewer
   silence events than hesitant.
2. Judge: judge_delivery scores each clip on one fixed delivery dimension;
   the score must order fluent > hesitant and fluent > filler, both strictly.
"""
from __future__ import annotations

from pathlib import Path

import soundfile as sf

from scorer.delivery.dsp import compute_delivery_metrics
from scorer.delivery.judge import judge_delivery
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    GenAIClientLike,
    RubricDimension,
    SourceCitation,
    TranscriptSegment,
)

_VARIANTS = ("fluent", "filler", "hesitant")

# One fixed, minimal delivery dimension: the suite tests the judge's ability to
# separate delivery quality, not rubric compilation, so the dimension is a
# constant rather than a compiled artifact.
EVAL_DELIVERY_DIMENSION = RubricDimension(
    key="delivery-fluency",
    name="Delivery fluency",
    weight=1.0,
    channel="delivery",
    anchors=[
        BarsAnchor(
            score=1,
            behavior=(
                "Long pauses, frequent fillers and restarts; "
                "the listener works to follow."
            ),
        ),
        BarsAnchor(
            score=3,
            behavior="Occasional hesitation and fillers, but the answer keeps moving.",
        ),
        BarsAnchor(
            score=5,
            behavior="Fluent, steady pacing with minimal fillers and no long pauses.",
        ),
    ],
    signals=[
        "pause frequency and length",
        "filler frequency",
        "steady pace without restarts",
    ],
    citations=[
        SourceCitation(
            url="https://example.com/delivery-eval",
            title="Synthetic eval dimension",
            snippet="Fixed dimension used only by the layer-3 delivery discrimination suite.",
        )
    ],
)


def find_triplets(clips_dir: Path) -> list[tuple[str, dict[str, Path]]]:
    """Discover (question, {variant: path}) triplets by the documented convention."""
    clips_dir = Path(clips_dir)
    triplets: list[tuple[str, dict[str, Path]]] = []
    for fluent in sorted(clips_dir.glob("*-fluent.wav")):
        question = fluent.name[: -len("-fluent.wav")]
        clips = {variant: clips_dir / f"{question}-{variant}.wav" for variant in _VARIANTS}
        missing = sorted(p.name for p in clips.values() if not p.exists())
        if missing:
            raise SystemExit(
                f"incomplete triplet {question!r} in {clips_dir}: "
                f"missing {missing} - see clips/README.md"
            )
        triplets.append((question, clips))
    return triplets


def _whole_clip_segment(path: Path) -> list[TranscriptSegment]:
    # Eval clips have no transcript. One fabricated candidate segment spanning
    # the whole clip gives the DSP a candidate window for silence detection; the
    # WPM and filler numbers derived from its empty text are meaningless and
    # unused by this suite.
    duration = float(sf.info(str(path)).duration)
    return [TranscriptSegment(start_s=0.0, end_s=duration, speaker="candidate", text="")]


def run_delivery_discrimination(clips_dir: Path, client: GenAIClientLike) -> dict:
    triplets = find_triplets(Path(clips_dir))
    dsp_pass = 0
    judge_pass = 0
    failures: list[dict] = []
    for question, clips in triplets:
        metrics: dict[str, DeliveryMetrics] = {}
        for variant in _VARIANTS:
            clip = clips[variant]
            metrics[variant] = compute_delivery_metrics(clip, _whole_clip_segment(clip))
        # DSP separability covers silence/pace only. Fillers ("um", "uh") are
        # ordinary voiced audio to the DSP -- separating the filler clip needs a
        # transcript, so filler discrimination is judge-only in v0.1.
        silence_counts = {v: len(metrics[v].silence_events) for v in _VARIANTS}
        if silence_counts["fluent"] < silence_counts["hesitant"]:
            dsp_pass += 1
        else:
            failures.append({
                "question": question,
                "check": "dsp",
                "silence_events": silence_counts,
                "reason": "fluent does not have strictly fewer silence events than hesitant",
            })
        judge_scores: dict[str, float] = {}
        judge_failure: dict | None = None
        for variant in _VARIANTS:
            scores, _observations = judge_delivery(
                clips[variant], metrics[variant], [EVAL_DELIVERY_DIMENSION], client
            )
            matched = next(
                (s for s in scores if s.dimension_key == EVAL_DELIVERY_DIMENSION.key), None
            )
            if matched is None:
                judge_failure = {
                    "question": question,
                    "check": "judge",
                    "scores": dict(judge_scores),
                    "reason": (
                        f"dimension {EVAL_DELIVERY_DIMENSION.key!r} missing from "
                        f"judge output for the {variant} clip"
                    ),
                }
                break
            judge_scores[variant] = matched.score
        if judge_failure is not None:
            failures.append(judge_failure)
        elif (
            judge_scores["fluent"] > judge_scores["hesitant"]
            and judge_scores["fluent"] > judge_scores["filler"]
        ):
            judge_pass += 1
        else:
            failures.append({
                "question": question,
                "check": "judge",
                "scores": judge_scores,
                "reason": "judge scores do not order fluent > hesitant and fluent > filler",
            })
    return {
        "triplets": len(triplets),
        "dsp_pass": dsp_pass,
        "judge_pass": judge_pass,
        "failures": failures,
    }
