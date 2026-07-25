from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from statistics import quantiles

from ..env import load_env, require_key
from .audio_io import chunked, load_pcm16
from .base import (
    RealtimeProbe,
    SessionEvent,
    TurnMetrics,
    collect_turn_metrics,
    count_attempted_turns,
)

OUT_DIR = Path(__file__).resolve().parents[4].parent / "evals" / "suites" / "bakeoff" / "out"
INTERVIEWER_PROMPT = (Path(__file__).resolve().parents[4].parent
                      / "evals" / "suites" / "bakeoff" / "interviewer_prompt.md")

PACING_S = 0.2          # send a 200 ms chunk every 200 ms — real-time pacing
ANSWER_WINDOW_S = 6.0   # let the model answer before the next turn
DRAIN_TIMEOUT_S = 10.0  # cap on waiting for the event stream to finish
RESUME_WAIT_S = 15.0    # how long a send failure may be a reconnect in progress
RESUME_POLL_S = 0.05    # how often that window is re-checked


@dataclass
class ScenarioResult:
    provider: str
    mode: str
    turns: list[TurnMetrics] = field(default_factory=list)
    turns_attempted: int = 0
    disconnects: int = 0
    errors: int = 0
    resumptions: int = 0
    send_failures: int = 0
    total_minutes: float = 0.0

    def summary(self) -> dict:
        lats = sorted(t.latency_ms for t in self.turns)
        q = quantiles(lats, n=100) if len(lats) >= 2 else lats * 2
        return {
            "provider": self.provider, "mode": self.mode, "turns": len(lats),
            "turns_attempted": self.turns_attempted,
            "latency_p50_ms": q[49] if len(lats) >= 2 else (lats[0] if lats else None),
            "latency_p95_ms": q[94] if len(lats) >= 2 else (lats[0] if lats else None),
            "disconnects": self.disconnects, "errors": self.errors,
            "resumptions": self.resumptions, "send_failures": self.send_failures,
            "total_minutes": round(self.total_minutes, 2),
        }

    def write(self, out_dir: Path) -> Path:
        out_dir.mkdir(parents=True, exist_ok=True)
        p = out_dir / f"{self.provider}-{self.mode}.json"
        p.write_text(json.dumps(self.summary(), indent=2))
        return p


async def run_scenario(probe: RealtimeProbe, clips: list[Path], minutes: float | None,
                       instructions: str) -> ScenarioResult:
    """Feed clips as turns; if minutes is set, loop clips until the wall clock passes it."""
    mode = "stability" if minutes else "latency"
    res = ScenarioResult(provider=probe.name, mode=mode)
    t_start = time.monotonic()
    await probe.connect(instructions)
    events: list[SessionEvent] = []

    async def consume():
        async for e in probe.events():
            events.append(e)
            if e.kind == "session.close":
                res.disconnects += 1
            elif e.kind == "session.error":
                res.errors += 1
            elif e.kind == "session.resumed":
                res.resumptions += 1

    consumer = asyncio.create_task(consume())
    deadline = (minutes or 0) * 60
    i = 0
    while True:
        clip = clips[i % len(clips)]
        pcm = load_pcm16(clip, probe.input_sample_rate)
        try:
            for ch in chunked(pcm, probe.input_sample_rate):
                await probe.send_audio(ch)
                await asyncio.sleep(PACING_S)
            await probe.commit_and_respond()
        except Exception as exc:  # noqa: BLE001 — any transport failure, not just one library's
            # A send can fail for two very different reasons. On an adapter that
            # reconnects (Gemini), it is usually a reconnect in progress: the
            # session object is dead for a moment and comes back seconds later,
            # and ending the run there is what made a 22-minute stability run
            # stop at the first go_away. So wait the window out first.
            # Otherwise the transport is simply gone: a dead transport must not
            # destroy the run's output either — the run that disconnects is the
            # one whose numbers we most need — so stop sending, record it, and
            # let the consumer drain whatever the session produced.
            if not (probe.resumable and await _await_resume(events, len(events))):
                res.send_failures += 1
                print(f"send failed on turn {i + 1} — {exc!r}; draining the session")
                break
            # Resumed. The turn is dropped rather than resent: a resumed session
            # restores conversation context, but the state of the half-sent
            # realtime input is undefined, so resending risks feeding the
            # interviewer a duplicated half-utterance. The cost is one latency
            # sample per reconnect (~2 in a 22-minute run).
            print(f"send failed on turn {i + 1} — {exc!r}; session resumed, turn dropped")
        else:
            await asyncio.sleep(ANSWER_WINDOW_S)
        i += 1
        if minutes is None and i >= len(clips):
            break
        if minutes is not None and time.monotonic() - t_start >= deadline:
            break
    with contextlib.suppress(Exception):
        await probe.close()
    await _drain(consumer)
    res.turns = collect_turn_metrics(events)
    res.turns_attempted = count_attempted_turns(events)
    res.total_minutes = (time.monotonic() - t_start) / 60
    return res


async def _await_resume(events: list[SessionEvent], seen: int) -> bool:
    """Bounded wait for the adapter to reconnect after a send hit a dead session.

    `seen` is the length of `events` at the moment the send failed, so only
    what happens *after* the failure counts — an earlier reconnect must not be
    mistaken for this one. Returns True on `session.resumed`, False as soon as
    the resume itself fails (`session.error` with `phase="resume"` — final, no
    point sitting out the window) or when the window closes.
    """
    deadline = time.monotonic() + RESUME_WAIT_S
    while True:
        for e in events[seen:]:
            if e.kind == "session.resumed":
                return True
            if e.kind == "session.error" and e.payload.get("phase") == "resume":
                return False
        seen = len(events)
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(RESUME_POLL_S)


async def _drain(consumer: asyncio.Task) -> None:
    """Wait for the event stream to finish — bounded, and never fatal."""
    try:
        await asyncio.wait_for(consumer, timeout=DRAIN_TIMEOUT_S)
    except TimeoutError:
        consumer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await consumer
    except Exception:  # noqa: BLE001 — a consumer crash must not eat the results either
        pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["openai", "gemini"], required=True)
    ap.add_argument("--mode", choices=["latency", "stability"], default="latency")
    ap.add_argument("--minutes", type=float, default=22.0)
    ap.add_argument("--clips", default=str(OUT_DIR.parent / "clips" / "turns"))
    args = ap.parse_args()
    load_env()
    if args.provider == "openai":
        require_key("OPENAI_API_KEY")
        from .openai_probe import OpenAIProbe
        probe: RealtimeProbe = OpenAIProbe(vad=False)
    else:
        require_key("GEMINI_API_KEY")
        from .gemini_probe import GeminiProbe
        probe = GeminiProbe(vad=False)
    clips = sorted(Path(args.clips).glob("*.wav"))
    if not clips:
        raise SystemExit(
            f"no clips in {args.clips} — record per evals/suites/bakeoff/manual_protocol.md")
    minutes = args.minutes if args.mode == "stability" else None
    instructions = INTERVIEWER_PROMPT.read_text()
    res = asyncio.run(run_scenario(probe, clips, minutes, instructions))
    print(json.dumps(res.summary(), indent=2))
    print(f"wrote {res.write(OUT_DIR)}")


if __name__ == "__main__":
    main()
