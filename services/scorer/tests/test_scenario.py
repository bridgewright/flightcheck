import json
import time
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


def _clip(tmp_path, name: str = "q.wav") -> Path:
    f = tmp_path / name
    sf.write(f, np.zeros(1600), 16000)
    return f


class _DeadTransportProbe(FakeProbe):
    """Sends raise once the session is gone — what every real disconnect does."""

    async def send_audio(self, pcm16: bytes) -> None:
        raise ConnectionResetError("sent 1011 (internal error); no close frame received")


class _ResumableDeadTransportProbe(_DeadTransportProbe):
    """A provider that reconnects (Gemini) whose session never actually comes back."""
    resumable = True


class _ReconnectingProbe(FakeProbe):
    """Fails the first send, then works — the Gemini `_resume` window exactly.

    During `GeminiProbe._resume` the session object is dead, so
    `send_realtime_input` raises; moments later the adapter reconnects and
    emits `session.resumed`.
    """
    resumable = True

    def __init__(self, script):
        super().__init__(script)
        self.failed_sends = 0

    async def send_audio(self, pcm16: bytes) -> None:
        if not self.failed_sends:
            self.failed_sends += 1
            raise ConnectionResetError("sent 1011 (internal error); no close frame received")
        await super().send_audio(pcm16)


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


# -- the reconnect window (R2-1): a send that lands mid-resume must not end the run --

async def test_send_failure_inside_the_reconnect_window_resumes_the_run(tmp_path):
    # Gemini's first go_away lands ~10 min into a 22-min stability run. If the
    # send guard breaks on the send that hits the dead session, the run ends
    # there and the stability comparison measures the websocket cap instead.
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(2500.0, "session.close", {"code": 1001}),   # go_away
        SessionEvent(2600.0, "session.resumed", {"handle": "h1"}),
        SessionEvent(2700.0, "turn.commit", {"turn": 1}),
        SessionEvent(3300.0, "audio.delta", {}),
    ]
    probe = _ReconnectingProbe(script)
    clips = [_clip(tmp_path, "a.wav"), _clip(tmp_path, "b.wav")]
    res = await run_scenario(probe, clips=clips, minutes=None, instructions="x")
    assert res.send_failures == 0            # recovered, so it is not a run-ending failure
    assert res.resumptions == 1
    assert probe.commits == 1                # the interrupted turn is dropped, the next one runs
    assert res.summary()["latency_p50_ms"] == 600.0


async def test_send_failure_that_never_resumes_ends_the_run_gracefully(tmp_path, monkeypatch):
    monkeypatch.setattr(scenario, "RESUME_WAIT_S", 0.05)
    monkeypatch.setattr(scenario, "RESUME_POLL_S", 0.01)
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(2500.0, "session.close", {"code": 1006}),
    ]
    res = await run_scenario(_ResumableDeadTransportProbe(script), clips=[_clip(tmp_path)],
                             minutes=None, instructions="x")
    assert res.send_failures == 1 and res.resumptions == 0
    assert res.disconnects == 1              # the consumer still drained the stream


async def test_resume_failure_ends_the_run_without_waiting_out_the_window(tmp_path, monkeypatch):
    monkeypatch.setattr(scenario, "RESUME_WAIT_S", 5.0)
    monkeypatch.setattr(scenario, "RESUME_POLL_S", 0.01)
    script = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(2500.0, "session.close", {"code": 1006}),
        SessionEvent(2600.0, "session.error", {"error": "no", "phase": "resume"}),
    ]
    t0 = time.monotonic()
    res = await run_scenario(_ResumableDeadTransportProbe(script), clips=[_clip(tmp_path)],
                             minutes=None, instructions="x")
    assert res.send_failures == 1 and res.errors == 1
    assert time.monotonic() - t0 < 1.0       # a failed resume is final; do not sit out the window


async def test_provider_without_resumption_ends_the_run_immediately(tmp_path, monkeypatch):
    # OpenAI has no resumption events, so waiting for one would only pad the
    # measured wall clock of a run that is already over.
    monkeypatch.setattr(scenario, "RESUME_WAIT_S", 5.0)
    monkeypatch.setattr(scenario, "RESUME_POLL_S", 0.01)
    script = [SessionEvent(0.0, "session.open", {}),
              SessionEvent(2500.0, "session.close", {"code": 1006})]
    t0 = time.monotonic()
    res = await run_scenario(_DeadTransportProbe(script), clips=[_clip(tmp_path)],
                             minutes=None, instructions="x")
    assert res.send_failures == 1
    assert time.monotonic() - t0 < 1.0


async def test_scenario_result_serializes(tmp_path):
    res = await run_scenario(FakeProbe([SessionEvent(0.0, "session.open", {})]),
                             clips=[_clip(tmp_path)], minutes=None, instructions="x")
    res.write(tmp_path)
    assert (tmp_path / "fake-latency.json").exists()
