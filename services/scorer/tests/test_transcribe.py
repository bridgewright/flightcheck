"""Tests for scorer.content.transcribe -- verbatim transcription (no network)."""
import json

from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.content.transcribe import TranscriptDoc, transcribe_verbatim
from scorer.schemas import TranscriptSegment

TRANSCRIPT_JSON = json.dumps({
    "segments": [
        {
            "start_s": 6.5,
            "end_s": 21.0,
            "speaker": "candidate",
            "text": "Um, so, uh, I led the the churn dashboard rollout.",
        },
        {
            "start_s": 0.0,
            "end_s": 6.0,
            "speaker": "interviewer",
            "text": "Tell me about a project you led end to end.",
        },
    ],
})


def test_transcribe_uploads_audio_and_returns_sorted_segments(tmp_path):
    audio = tmp_path / "session.wav"
    audio.write_bytes(b"RIFF")
    fake = FakeGenAI([TRANSCRIPT_JSON])

    segments = transcribe_verbatim(audio, fake)

    assert fake.files.uploads == [audio]
    assert all(isinstance(seg, TranscriptSegment) for seg in segments)
    # Canned JSON is deliberately out of order; output sorts by start_s.
    assert [seg.start_s for seg in segments] == [0.0, 6.5]
    assert segments[0].speaker == "interviewer"
    assert segments[1].text == (
        "Um, so, uh, I led the the churn dashboard rollout."
    )


def test_transcribe_makes_one_structured_call_with_file_handle(tmp_path):
    audio = tmp_path / "session.wav"
    audio.write_bytes(b"RIFF")
    fake = FakeGenAI([TRANSCRIPT_JSON])

    transcribe_verbatim(audio, fake)

    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["model"] == load_product_config().models.scorer
    config = call["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema is TranscriptDoc
    contents = call["contents"]
    assert isinstance(contents, list)
    assert len(contents) == 2
    assert not isinstance(contents[0], str)  # the uploaded file handle
    prompt = contents[1]
    assert "VERBATIM" in prompt
    assert '"uh"' in prompt
    assert '"um"' in prompt
    assert "false start" in prompt
    assert '"interviewer"' in prompt
    assert '"candidate"' in prompt
    assert "seconds" in prompt
