import json

from scorer.realtime_probe.openai_probe import OpenAIProbe


def test_wire_event_mapping():
    p = OpenAIProbe(model="gpt-realtime")
    e = p._map_wire({"type": p.WIRE["audio_delta"], "delta": "AAAA"})
    assert e is not None and e.kind == "audio.delta"
    e2 = p._map_wire({"type": p.WIRE["response_done"]})
    assert e2 is not None and e2.kind == "audio.done"
    assert p._map_wire({"type": "rate_limits.updated"}) is None  # noise dropped


def test_session_update_uses_ga_nested_schema():
    # GA shape verified against developers.openai.com realtime client-events
    # reference on 2026-07-25: session.type discriminator, output_modalities
    # (not modalities), turn_detection nested under session.audio.input.
    p = OpenAIProbe(model="gpt-realtime", vad=False)
    msg = json.loads(p._session_update("Be a tough interviewer."))
    assert msg["type"] == "session.update"
    session = msg["session"]
    assert session["type"] == "realtime"
    assert session["instructions"] == "Be a tough interviewer."
    assert session["output_modalities"] == ["audio"]
    assert "modalities" not in session          # legacy key must be gone
    assert "turn_detection" not in session      # legacy flat location must be gone
    assert session["audio"]["input"]["turn_detection"] is None
    assert p._turn_detection_off(msg)


def test_session_update_enables_server_vad_in_nested_location():
    p = OpenAIProbe(model="gpt-realtime", vad=True)
    session = json.loads(p._session_update("x"))["session"]
    assert session["audio"]["input"]["turn_detection"] == {"type": "server_vad"}
    assert not OpenAIProbe._turn_detection_off({"session": session})


def test_turn_detection_off_rejects_legacy_flat_payload():
    # The pre-GA payload set session.turn_detection=None; the GA server ignores
    # that key, so server VAD stays on. The checker must not call it disabled.
    legacy = {"session": {"instructions": "x", "modalities": ["audio", "text"],
                          "turn_detection": None}}
    assert not OpenAIProbe._turn_detection_off(legacy)


def test_probe_constructs_without_api_key_in_environment(monkeypatch):
    # Missing-key handling belongs to the CLI entrypoints (one clear SystemExit),
    # not to a KeyError deep in a constructor.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert OpenAIProbe(model="gpt-realtime").api_key == ""
