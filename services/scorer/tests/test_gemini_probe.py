import asyncio
from unittest.mock import AsyncMock

from google.genai import types

from scorer.realtime_probe.gemini_probe import GeminiProbe

def test_live_config_requests_audio_and_resumption():
    p = GeminiProbe(model="gemini-2.5-flash-native-audio-preview-09-2025")
    cfg = p._live_config("Be a tough interviewer.")
    assert cfg["response_modalities"] == ["AUDIO"]
    assert "session_resumption" in cfg
    assert "tough interviewer" in str(cfg["system_instruction"])

def test_server_message_mapping():
    p = GeminiProbe()
    assert p._classify({"data": b"\x00\x01"}) == "audio.delta"
    assert p._classify({"server_content": {"turn_complete": True}}) == "audio.done"
    assert p._classify({"session_resumption_update": {"new_handle": "h1"}}) == "resumption.update"
    assert p._classify({"setup_complete": {}}) is None

def test_commit_and_respond_sends_audio_stream_end_when_vad_enabled():
    # automatic_activity_detection is on (default) in this mode, so the SDK's
    # own docstring says audio_stream_end is the correct turn-end signal.
    p = GeminiProbe(vad=True)
    p._session = AsyncMock()
    asyncio.run(p.commit_and_respond())
    p._session.send_realtime_input.assert_awaited_once_with(audio_stream_end=True)

def test_commit_and_respond_sends_activity_end_when_vad_disabled():
    # _live_config sets automatic_activity_detection.disabled=True for
    # vad=False; the SDK docstring says audio_stream_end "should only be
    # sent when automatic activity detection is enabled" and ActivityEnd
    # "can only be sent if automatic ... activity detection is disabled" —
    # so manual mode must send activity_end instead, or the server never
    # gets a turn-end signal at all.
    p = GeminiProbe(vad=False)
    p._session = AsyncMock()
    asyncio.run(p.commit_and_respond())
    kwargs = p._session.send_realtime_input.call_args.kwargs
    assert "audio_stream_end" not in kwargs
    assert isinstance(kwargs.get("activity_end"), types.ActivityEnd)
