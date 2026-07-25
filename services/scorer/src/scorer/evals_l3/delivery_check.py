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
from scorer.delivery.judge import DeliveryJudgeError, judge_delivery
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
    # Eval clips have no transcript. dsp.compute_delivery_metrics only opens a
    # silence-detection window BETWEEN two interviewer segments (see
    # delivery.dsp._candidate_windows) -- with zero interviewer segments there
    # are zero windows, so silence_events would always come back empty
    # regardless of the audio. A zero-length interviewer segment at t=0.0
    # opens exactly one window spanning the whole clip, so the candidate
    # segment that follows can register real silence. The candidate segment's
    # own WPM/filler numbers (from its empty text) are still meaningless and
    # unused by this suite.
    duration = float(sf.info(str(path)).duration)
    return [
        TranscriptSegment(start_s=0.0, end_s=0.0, speaker="interviewer", text="(question)"),
        TranscriptSegment(start_s=0.0, end_s=duration, speaker="candidate", text=""),
    ]


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
            try:
                scores, _observations = judge_delivery(
                    clips[variant], metrics[variant], [EVAL_DELIVERY_DIMENSION], client
                )
            except DeliveryJudgeError as exc:
                # One unusable judge reply is a data point, not the end of the
                # run (mirrors evals_l1.golden's ContentJudgeError discipline):
                # record it and move on to the next triplet. judge_delivery
                # itself raises DeliveryJudgeError whenever a requested
                # delivery dimension is missing from the response, so there is
                # no separate "matched is None" case to defend against here.
                judge_failure = {
                    "question": question,
                    "check": "judge",
                    "scores": dict(judge_scores),
                    "reason": f"{type(exc).__name__}: {str(exc)[:120]}",
                }
                break
            judge_scores[variant] = next(
                s.score for s in scores if s.dimension_key == EVAL_DELIVERY_DIMENSION.key
            )
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
