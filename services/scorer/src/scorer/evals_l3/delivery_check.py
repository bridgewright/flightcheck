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

_VARIANTS = ("fluent", "filler", "hesitant")


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
