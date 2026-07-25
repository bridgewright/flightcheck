import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scorer.realtime_probe import scenario
from scorer.realtime_probe.base import SessionEvent
from scorer.realtime_probe.fake import FakeProbe
from scorer.realtime_probe.scenario import run_scenario


@pytest.fixture(autouse=True)
def _drop_realtime_pacing(monkeypatch):
    """Zero the pacing/answer sleeps: fast tests, and a nominal elapsed sum
    would then be exactly 0.0 — which is what makes measured time observable."""
    monkeypatch.setattr(scenario, "PACING_S", 0.0)
    monkeypatch.setattr(scenario, "ANSWER_WINDOW_S", 0.0)


def _clip(tmp_path) -> Path:
    f = tmp_path / "q.wav"
    sf.write(f, np.zeros(1600), 16000)
    return f


class _DeadTransportProbe(FakeProbe):
    """Sends raise once the session is gone — what every real disconnect does."""

    async def send_audio(self, pcm16: bytes) -> None:
        raise ConnectionResetError("sent 1011 (internal error); no close frame received")


async def test_scenario_counts_disconnects_errors_and_resumptions(tmp_path):
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(100.0, "turn.commit", {"turn": 1}),
        SessionEvent(700.0, "audio.delta", {}),
        SessionEvent(1500.0, "audio.done", {}),
        SessionEvent(2000.0, "resumption.update", {"handle": "h1"}),
        SessionEvent(2500.0, "session.close", {"code": 1000}),
        SessionEvent(2600.0, "session.resumed", {"handle": "h1"}),
        SessionEvent(3000.0, "session.error", {"error": "server error"}),
    ]
    res = await run_scenario(FakeProbe(script), clips=[_clip(tmp_path)],
                             minutes=None, instructions="x")
    # a resumption is a completed reconnect, not a handle the server handed out
    assert res.disconnects == 1 and res.resumptions == 1 and res.errors == 1
    assert res.summary()["latency_p50_ms"] == 600.0
    assert res.summary()["errors"] == 1


async def test_scenario_reports_attempted_turns_alongside_answered_ones(tmp_path):
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(100.0, "turn.commit", {"turn": 1}),
        SessionEvent(700.0, "audio.delta", {}),
        SessionEvent(2000.0, "turn.commit", {"turn": 2}),   # never answered
    ]
    res = await run_scenario(FakeProbe(script), clips=[_clip(tmp_path)],
                             minutes=None, instructions="x")
    summary = res.summary()
    assert summary["turns"] == 1 and summary["turns_attempted"] == 2


async def test_dead_transport_still_produces_a_written_result(tmp_path):
    # The run that disconnects is exactly the run whose numbers matter; an
    # unguarded send on a dead socket used to abort run_scenario before write().
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(100.0, "turn.commit", {"turn": 1}),
        SessionEvent(700.0, "audio.delta", {}),
        SessionEvent(2500.0, "session.close", {"code": 1006}),
    ]
    res = await run_scenario(_DeadTransportProbe(script), clips=[_clip(tmp_path)],
                             minutes=None, instructions="x")
    assert res.send_failures == 1
    assert res.disconnects == 1            # the consumer still drained the stream
    assert res.summary()["latency_p50_ms"] == 600.0
    written = json.loads(res.write(tmp_path).read_text())
    assert written["send_failures"] == 1


async def test_total_minutes_is_measured_not_summed_from_sleep_constants(tmp_path):
    res = await run_scenario(FakeProbe([SessionEvent(0.0, "session.open", {})]),
                             clips=[_clip(tmp_path)], minutes=None, instructions="x")
    # pacing constants are zeroed by the fixture, so a nominal sum is exactly
    # 0.0; a wall clock measured from connect to close never is.
    assert res.total_minutes > 0.0
    assert res.total_minutes < 0.5


async def test_scenario_result_serializes(tmp_path):
    res = await run_scenario(FakeProbe([SessionEvent(0.0, "session.open", {})]),
                             clips=[_clip(tmp_path)], minutes=None, instructions="x")
    res.write(tmp_path)
    assert (tmp_path / "fake-latency.json").exists()
