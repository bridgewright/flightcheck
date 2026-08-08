"""Transcript grouping shared with the web transcript renderer."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from scorer.schemas import TranscriptSegment


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    speaker: str
    start_s: float
    end_s: float
    text: str


def group_turns(segments: list[TranscriptSegment]) -> list[Turn]:
    turns: list[Turn] = []
    for segment in sorted(segments, key=lambda item: item.start_s):
        if turns and turns[-1].speaker == segment.speaker:
            previous = turns[-1]
            turns[-1] = previous.model_copy(update={
                "end_s": segment.end_s,
                "text": f"{previous.text} {segment.text}".strip(),
            })
        else:
            turns.append(Turn(**segment.model_dump()))
    return turns


def candidate_turns(segments: list[TranscriptSegment]) -> list[Turn]:
    """Candidate turns in order; their list index is the stored ordinal."""
    return [turn for turn in group_turns(segments) if turn.speaker == "candidate"]
