"""F-04 scoring eligibility: is there enough evidence to score at all?

A verdict from a few minutes of speech would be noise sold as signal, so the
pipeline gates judge spend on evidence volume. Pure function over the
transcript and the recording duration; every threshold lives in
config/product.toml ([eligibility]), never in code.

Three-way verdict:
- "insufficient": below a hard floor. The pipeline makes NO judge calls and
  saves no report; the session ends in terminal status "insufficient" with
  its slot preserved (retriable, consistent with the F-17 guard policy).
- "limited": at or above every floor but below a full-evidence bar (a 10-15
  minute or thin-content session). Scores stand, but the report carries
  eligibility="limited" and the limits note says so.
- "scored": full evidence.
"""
from __future__ import annotations

from typing import Literal

from scorer.config import EligibilityConfig
from scorer.schemas import TranscriptSegment

EligibilityVerdict = Literal["scored", "limited", "insufficient"]


def _candidate_turns(segments: list[TranscriptSegment]) -> int:
    """Maximal runs of candidate speech -- the transcriber may split one
    answer into several consecutive segments, which is still one turn."""
    turns = 0
    previous = None
    for segment in segments:
        if segment.speaker == "candidate" and previous != "candidate":
            turns += 1
        previous = segment.speaker
    return turns


def _candidate_words(segments: list[TranscriptSegment]) -> int:
    return sum(
        len(segment.text.split())
        for segment in segments
        if segment.speaker == "candidate"
    )


def check_eligibility(
    segments: list[TranscriptSegment],
    duration_s: float,
    cfg: EligibilityConfig,
) -> EligibilityVerdict:
    """Classify a session's evidence volume. All floors are inclusive."""
    turns = _candidate_turns(segments)
    words = _candidate_words(segments)
    if (
        duration_s < cfg.min_duration_s
        or turns < cfg.min_candidate_turns
        or words < cfg.min_candidate_words
    ):
        return "insufficient"
    if duration_s < cfg.full_duration_s or words < cfg.full_candidate_words:
        return "limited"
    return "scored"
