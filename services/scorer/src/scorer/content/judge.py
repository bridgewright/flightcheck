"""Content judge: scores content-channel rubric dimensions against the transcript.

One file-based Gemini call. The prompt carries the candidate-labeled transcript
(with timestamps) and, for each content dimension, its BARS anchors verbatim, so
scores anchor to observable behavior. Returned evidence quotes are then verified
in code against the actual candidate speech (see later steps) — fabricated
quotes are dropped rather than trusted.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from scorer.config import load_product_config
from scorer.schemas import (
    DimensionScore,
    GenAIClientLike,
    Rubric,
    RubricDimension,
    TranscriptSegment,
)


class ContentJudgeError(Exception):
    """The judge response is unusable (a content dimension is missing)."""


class ContentScoreDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scores: list[DimensionScore]


_RULES = (
    "Scoring rules:\n"
    "- Score each listed dimension from 1.0 to 5.0. Anchor every score to the BARS\n"
    "  anchor language above. Interpolating between anchors (for example 3.5) is allowed.\n"
    "- evidence_quotes must be verbatim quotes from CANDIDATE lines of the transcript.\n"
    "  Never quote interviewer lines and never paraphrase.\n"
    "- rationale must tie the quoted evidence to the anchor language it matches.\n"
    "- Give no credit for anything the interviewer said; only candidate speech counts.\n"
    "- Return a score for every listed dimension, using its exact dimension key."
)


def _fmt_ts(seconds: float) -> str:
    total = int(seconds)
    return f"[{total // 60:02d}:{total % 60:02d}]"


def _transcript_block(segments: list[TranscriptSegment]) -> str:
    return "\n".join(
        f"{_fmt_ts(seg.start_s)} {seg.speaker.upper()}: {seg.text}" for seg in segments
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
    rubric: Rubric,
    content_dims: list[RubricDimension],
    segments: list[TranscriptSegment],
) -> str:
    dims = "\n\n".join(_dimension_block(d) for d in content_dims)
    return (
        f"You are scoring a mock interview for the role: {rubric.role_title}.\n"
        "Score ONLY the content dimensions listed below, using only the transcript.\n\n"
        "Transcript (timestamped, speaker-labeled):\n"
        f"{_transcript_block(segments)}\n\n"
        f"Content dimensions to score:\n\n{dims}\n\n"
        f"{_RULES}"
    )


def score_content(
    rubric: Rubric,
    segments: list[TranscriptSegment],
    client: GenAIClientLike,
) -> list[DimensionScore]:
    content_dims = [d for d in rubric.dimensions if d.channel == "content"]
    response = client.models.generate_content(
        model=load_product_config().models.scorer,
        contents=_build_prompt(rubric, content_dims, segments),
        config={
            "response_mime_type": "application/json",
            "response_schema": ContentScoreDoc,
        },
    )
    doc = ContentScoreDoc.model_validate_json(response.text)
    return list(doc.scores)
