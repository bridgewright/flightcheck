from pathlib import Path
import numpy as np, soundfile as sf
from scorer.realtime_probe.base import SessionEvent
from scorer.realtime_probe.fake import FakeProbe
from scorer.realtime_probe.scenario import run_scenario

def _clip(tmp_path) -> Path:
    f = tmp_path / "q.wav"
    sf.write(f, np.zeros(1600), 16000)
    return f

async def test_scenario_counts_disconnects_and_resumptions(tmp_path):
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(100.0, "turn.commit", {"turn": 1}),
        SessionEvent(700.0, "audio.delta", {}),
        SessionEvent(1500.0, "audio.done", {}),
        SessionEvent(2000.0, "resumption.update", {"handle": "h1"}),
        SessionEvent(2500.0, "session.close", {"code": 1011}),
    ]
    res = await run_scenario(FakeProbe(script), clips=[_clip(tmp_path)], minutes=None, instructions="x")
    assert res.disconnects == 1 and res.resumptions == 1
    assert res.summary()["latency_p50_ms"] == 600.0

async def test_scenario_result_serializes(tmp_path):
    res = await run_scenario(FakeProbe([SessionEvent(0.0, "session.open", {})]),
                             clips=[_clip(tmp_path)], minutes=None, instructions="x")
    res.write(tmp_path)
    assert (tmp_path / "fake-latency.json").exists()
