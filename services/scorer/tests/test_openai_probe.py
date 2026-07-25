import json
from scorer.realtime_probe.openai_probe import OpenAIProbe

def test_wire_event_mapping():
    p = OpenAIProbe(model="gpt-realtime")
    e = p._map_wire({"type": p.WIRE["audio_delta"], "delta": "AAAA"})
    assert e is not None and e.kind == "audio.delta"
    e2 = p._map_wire({"type": p.WIRE["response_done"]})
    assert e2 is not None and e2.kind == "audio.done"
    assert p._map_wire({"type": "rate_limits.updated"}) is None  # noise dropped

def test_session_update_payload_carries_instructions():
    p = OpenAIProbe(model="gpt-realtime", vad=False)
    msg = json.loads(p._session_update("Be a tough interviewer."))
    assert msg["type"] == "session.update"
    assert "tough interviewer" in json.dumps(msg)
    assert p._turn_detection_off(msg)
