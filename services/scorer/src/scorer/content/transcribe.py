"""Verbatim transcription of a session recording via one Gemini file call.

Fillers, false starts, and repeats are the raw material of the delivery
channel (Task 8 counts them, Task 10 interprets them), so the prompt
forbids any cleanup. One upload + one structured generate_content call,
then pydantic validates the parsed JSON (pydantic is the validator of
record, not the model's own JSON mode).
"""
from __future__ import annotations

from pathlib import Path

from google.genai import types
from pydantic import BaseModel, ConfigDict

from scorer.config import load_product_config
from scorer.resilience import call_with_retry
from scorer.schemas import GenAIClientLike, TranscriptSegment


class TranscriptDoc(BaseModel):
    """Response-schema wrapper: the model returns one object, not a list."""

    model_config = ConfigDict(extra="forbid")

    segments: list[TranscriptSegment]


_TRANSCRIBE_PROMPT = (
    "Transcribe this mock-interview recording VERBATIM.\n"
    "Rules:\n"
    '- Keep every filler ("uh", "um", "erm"), every false start, and\n'
    "  every repeated word exactly as spoken. Never clean up, summarize,\n"
    "  or paraphrase anything.\n"
    '- Label each segment speaker: "interviewer" is the synthetic\n'
    '  interviewer voice; "candidate" is the human being interviewed.\n'
    "- start_s and end_s are timestamps in seconds from the start of the\n"
    "  recording.\n"
    "- Start a new segment at every speaker change."
)


def transcribe_verbatim(
    audio_path: Path, client: GenAIClientLike
) -> list[TranscriptSegment]:
    """Upload the wav and return verbatim segments sorted by start time.

    Both calls back off transient failures (F-37). This step is the
    one that most needed it: it is the most expensive call in the
    pipeline and its input is a 20-minute interview that happened
    once, so a 503 here does not cost a retry -- it costs the
    recording.
    """
    handle = call_with_retry(
        lambda: client.files.upload(file=audio_path),
        what="transcription upload",
    )
    response = call_with_retry(
        lambda: client.models.generate_content(
            model=load_product_config().models.scorer,
            contents=[handle, _TRANSCRIBE_PROMPT],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=TranscriptDoc,
            ),
        ),
        what="transcription",
    )
    doc = TranscriptDoc.model_validate_json(response.text)
    return sorted(doc.segments, key=lambda seg: seg.start_s)
