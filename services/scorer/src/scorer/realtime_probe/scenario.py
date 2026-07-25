from __future__ import annotations
import argparse, asyncio, json, os
from dataclasses import dataclass, field
from pathlib import Path
from statistics import quantiles
from .base import RealtimeProbe, SessionEvent, TurnMetrics, collect_turn_metrics
from .audio_io import load_pcm16, chunked

OUT_DIR = Path(__file__).resolve().parents[4].parent / "evals" / "suites" / "bakeoff" / "out"
INTERVIEWER_PROMPT = (Path(__file__).resolve().parents[4].parent
                      / "evals" / "suites" / "bakeoff" / "interviewer_prompt.md")


@dataclass
class ScenarioResult:
    provider: str
    mode: str
    turns: list[TurnMetrics] = field(default_factory=list)
    disconnects: int = 0
    resumptions: int = 0
    total_minutes: float = 0.0

    def summary(self) -> dict:
        lats = sorted(t.latency_ms for t in self.turns)
        q = quantiles(lats, n=100) if len(lats) >= 2 else lats * 2
        return {
            "provider": self.provider, "mode": self.mode, "turns": len(lats),
            "latency_p50_ms": q[49] if len(lats) >= 2 else (lats[0] if lats else None),
            "latency_p95_ms": q[94] if len(lats) >= 2 else (lats[0] if lats else None),
            "disconnects": self.disconnects, "resumptions": self.resumptions,
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
    await probe.connect(instructions)
    events: list[SessionEvent] = []

    async def consume():
        async for e in probe.events():
            events.append(e)
            if e.kind == "session.close":
                res.disconnects += 1
            elif e.kind == "resumption.update":
                res.resumptions += 1

    consumer = asyncio.create_task(consume())
    deadline = (minutes or 0) * 60
    elapsed = 0.0
    i = 0
    while True:
        clip = clips[i % len(clips)]
        pcm = load_pcm16(clip, probe.input_sample_rate)
        for ch in chunked(pcm, probe.input_sample_rate):
            await probe.send_audio(ch)
            await asyncio.sleep(0.2)          # real-time pacing
            elapsed += 0.2
        await probe.commit_and_respond()
        await asyncio.sleep(6.0)              # let the model answer
        elapsed += 6.0
        i += 1
        if minutes is None and i >= len(clips):
            break
        if minutes is not None and elapsed >= deadline:
            break
    await probe.close()
    await consumer
    res.turns = collect_turn_metrics(events)
    res.total_minutes = elapsed / 60
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["openai", "gemini"], required=True)
    ap.add_argument("--mode", choices=["latency", "stability"], default="latency")
    ap.add_argument("--minutes", type=float, default=22.0)
    ap.add_argument("--clips", default=str(OUT_DIR.parent / "clips" / "turns"))
    args = ap.parse_args()
    if args.provider == "openai":
        from .openai_probe import OpenAIProbe
        probe: RealtimeProbe = OpenAIProbe(vad=False)
    else:
        from .gemini_probe import GeminiProbe
        probe = GeminiProbe(vad=False)
    clips = sorted(Path(args.clips).glob("*.wav"))
    if not clips:
        raise SystemExit(f"no clips in {args.clips} — record per evals/suites/bakeoff/manual_protocol.md")
    minutes = args.minutes if args.mode == "stability" else None
    instructions = INTERVIEWER_PROMPT.read_text()
    res = asyncio.run(run_scenario(probe, clips, minutes, instructions))
    print(json.dumps(res.summary(), indent=2))
    res.write(OUT_DIR)


if __name__ == "__main__":
    main()
