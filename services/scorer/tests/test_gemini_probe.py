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
