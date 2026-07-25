from __future__ import annotations

import argparse
import asyncio
import json
import queue
from pathlib import Path

import sounddevice as sd

from ..env import load_env, require_key
from .base import RealtimeProbe

OUT_DIR = Path(__file__).resolve().parents[4].parent / "evals" / "suites" / "bakeoff" / "out"


def frames_to_chunks(frames: list[bytes], chunk_bytes: int) -> tuple[list[bytes], bytes]:
    buf = b"".join(frames)
    chunks = [buf[i:i + chunk_bytes] for i in range(0, len(buf) - chunk_bytes + 1, chunk_bytes)]
    return chunks, buf[len(chunks) * chunk_bytes:]


class OutputRing:
    """Byte-level buffer between provider audio deltas and the audio callback.

    Provider deltas have no relationship to the device's block size: a 0.3 s
    delta @24 kHz is 14400 bytes against a 9600-byte block. Writing one delta
    per callback either overflowed the buffer (ValueError, stream dead) or
    padded silence after every short delta. Bytes in, exact block out.
    """

    def __init__(self) -> None:
        self._buf = bytearray()

    def write(self, pcm16: bytes) -> None:
        self._buf += pcm16

    def read(self, n: int) -> bytes:
        chunk = bytes(self._buf[:n])
        del self._buf[:n]
        return chunk + b"\x00" * (n - len(chunk))   # zero-fill only on true underrun


def make_output_callback(out_q: queue.Queue[bytes], ring: OutputRing | None = None):
    """sounddevice output callback: drain queued deltas into the ring, play a block.

    The ring is only ever touched on the audio thread; `out_q` does the
    cross-thread handoff.
    """
    ring = ring or OutputRing()

    def on_out(outdata, frames, t, status):
        while True:
            try:
                ring.write(out_q.get_nowait())
            except queue.Empty:
                break
        outdata[:] = ring.read(len(outdata))

    return on_out


async def run_mic(probe: RealtimeProbe, instructions: str, log_path: Path) -> None:
    await probe.connect(instructions)
    in_q: queue.Queue[bytes] = queue.Queue()
    out_q: queue.Queue[bytes] = queue.Queue()

    def on_in(indata, frames, t, status):
        in_q.put(bytes(indata))

    on_out = make_output_callback(out_q)

    async def pump_mic():
        buf: list[bytes] = []
        chunk_bytes = probe.input_sample_rate * 2 // 5  # 200 ms
        while True:
            while not in_q.empty():
                buf.append(in_q.get())
            chunks, rest = frames_to_chunks(buf, chunk_bytes)
            buf = [rest] if rest else []
            for c in chunks:
                await probe.send_audio(c)
            await asyncio.sleep(0.05)

    async def pump_events():
        with log_path.open("a") as f:
            async for e in probe.events():
                f.write(json.dumps({"t_ms": e.t_ms, "kind": e.kind}) + "\n")
                if e.kind == "audio.delta" and e.payload.get("pcm"):
                    out_q.put(e.payload["pcm"])

    with sd.RawInputStream(samplerate=probe.input_sample_rate, channels=1, dtype="int16",
                           blocksize=0, callback=on_in), \
         sd.RawOutputStream(samplerate=probe.output_sample_rate, channels=1, dtype="int16",
                            blocksize=4800, callback=on_out):
        print("Live session — speak. Ctrl-C to end.")
        await asyncio.gather(pump_mic(), pump_events())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", choices=["openai", "gemini"], required=True)
    args = ap.parse_args()
    load_env()
    if args.provider == "openai":
        require_key("OPENAI_API_KEY")
        from .openai_probe import OpenAIProbe
        probe: RealtimeProbe = OpenAIProbe(vad=True)
    else:
        require_key("GEMINI_API_KEY")
        from .gemini_probe import GeminiProbe
        probe = GeminiProbe(vad=True)
    prompt = (OUT_DIR.parent / "interviewer_prompt.md").read_text()
    n = len(list(OUT_DIR.glob(f"{args.provider}-mic-*.jsonl"))) + 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        asyncio.run(run_mic(probe, prompt, OUT_DIR / f"{args.provider}-mic-{n}.jsonl"))
    except KeyboardInterrupt:
        print("\nSession ended.")


if __name__ == "__main__":
    main()
