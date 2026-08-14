"""F-06 VAD bake-off probe (spec section 2, D1).

Streams scripted PCM tapes (say-synthesized speech + silence) to the OpenAI
Realtime WS endpoint under two turn_detection configs and records every server
event with timestamps + send-side segment marks. Run from services/scorer via
`uv run python` so scorer.env resolves the API key (never printed).

Configs:
  semantic       -> {"type": "semantic_vad", "eagerness": "low"}
  svad_nocreate  -> {"type": "server_vad", "silence_duration_ms": 900,
                     "prefix_padding_ms": 300, "create_response": False}
"""
from __future__ import annotations

import asyncio
import base64
import json
import sys
import time
from pathlib import Path

import websockets

from scorer.env import load_env, require_key

CLIPS = Path(__file__).parent / "clips"
OUT = Path(__file__).parent / "out"
URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime"
CHUNK_S = 0.2
SR = 24000
BYTES_PER_S = SR * 2  # pcm16 mono

CONFIGS: dict[str, dict | None] = {
    "semantic": {"type": "semantic_vad", "eagerness": "low"},
    "semantic_auto": {"type": "semantic_vad", "eagerness": "auto"},
    "svad_nocreate": {
        "type": "server_vad",
        "silence_duration_ms": 900,
        "prefix_padding_ms": 300,
        "create_response": False,
    },
    # F-67 Phase 1 re-audition (DECISIONS 075): semantic_vad in the exact
    # composition the product would run it — the client owns response
    # timing, so create_response is off. The 2026-08-01 cells above ran
    # semantic_vad with server-fired responses; these do not, and medium
    # replaces auto because the docs now name auto as medium's alias.
    "semantic_low_nocreate": {
        "type": "semantic_vad",
        "eagerness": "low",
        "create_response": False,
    },
    "semantic_medium_nocreate": {
        "type": "semantic_vad",
        "eagerness": "medium",
        "create_response": False,
    },
}

TAPES: dict[str, list] = {
    # ("clip", name) | ("silence", seconds)
    "pause": [("clip", "lead"), ("silence", 8.0), ("clip", "cont"), ("silence", 5.0)],
    "complete": [("clip", "complete"), ("silence", 6.0)],
    "filler": [
        ("clip", "lead"), ("silence", 2.0), ("clip", "um"), ("silence", 2.0),
        ("clip", "um"), ("silence", 2.0), ("clip", "um"), ("silence", 2.0),
        ("clip", "um"), ("silence", 5.0),
    ],
}

INSTRUCTIONS = (
    "You are Morgan, a warm professional mock interviewer. Reply in ONE short "
    "sentence only."
)


def tape_segments(tape: list) -> list[tuple[str, bytes]]:
    segs = []
    for kind, val in tape:
        if kind == "clip":
            segs.append((val, (CLIPS / f"{val}.pcm").read_bytes()))
        else:
            segs.append((f"silence_{val}s", b"\x00" * int(BYTES_PER_S * val)))
    return segs


async def run(config_name: str, tape_name: str) -> dict:
    turn_detection = CONFIGS[config_name]
    log: dict = {"config": config_name, "tape": tape_name, "events": [], "marks": []}
    t0 = time.monotonic()
    now_ms = lambda: round((time.monotonic() - t0) * 1000)  # noqa: E731

    ws = await websockets.connect(
        URL,
        additional_headers={"Authorization": f"Bearer {require_key('OPENAI_API_KEY')}"},
        max_size=None,
    )
    await ws.send(json.dumps({
        "type": "session.update",
        "session": {
            "type": "realtime",
            "instructions": INSTRUCTIONS,
            "output_modalities": ["audio"],
            "audio": {"input": {"turn_detection": turn_detection}},
        },
    }))

    delta_counts: dict[str, int] = {}

    async def reader():
        async for raw in ws:
            msg = json.loads(raw)
            t = msg.get("type", "")
            if t == "response.output_audio.delta":
                rid = msg.get("response_id", "?")
                if rid not in delta_counts:
                    log["events"].append({"t": now_ms(), "type": "first_audio_delta",
                                          "response_id": rid})
                delta_counts[rid] = delta_counts.get(rid, 0) + 1
                continue
            ev: dict = {"t": now_ms(), "type": t}
            if t == "input_audio_buffer.committed":
                ev["item_id"] = msg.get("item_id")
            if t == "response.created":
                ev["response_id"] = msg.get("response", {}).get("id")
            if t == "response.done":
                resp = msg.get("response", {})
                ev["status"] = resp.get("status")
                texts = []
                for item in resp.get("output", []) or []:
                    for c in item.get("content", []) or []:
                        if c.get("transcript"):
                            texts.append(c["transcript"])
                ev["transcript"] = " ".join(texts)[:200]
            if t == "error":
                ev["error"] = msg.get("error")
            log["events"].append(ev)

    reader_task = asyncio.create_task(reader())

    audio_pos = 0.0
    for label, pcm in tape_segments(TAPES[tape_name]):
        log["marks"].append({"t": now_ms(), "label": f"begin:{label}",
                             "audio_pos_s": round(audio_pos, 2)})
        for off in range(0, len(pcm), int(BYTES_PER_S * CHUNK_S)):
            chunk = pcm[off:off + int(BYTES_PER_S * CHUNK_S)]
            await ws.send(json.dumps({
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(chunk).decode(),
            }))
            await asyncio.sleep(CHUNK_S)
            audio_pos += len(chunk) / BYTES_PER_S
        log["marks"].append({"t": now_ms(), "label": f"end:{label}",
                             "audio_pos_s": round(audio_pos, 2)})
    await asyncio.sleep(6.0)  # drain window
    reader_task.cancel()
    await ws.close()
    log["delta_counts"] = delta_counts
    return log


def main() -> None:
    load_env()
    OUT.mkdir(exist_ok=True)
    combos = [(c, t) for c in CONFIGS for t in TAPES]
    if len(sys.argv) > 1:
        combos = [tuple(a.split(":")) for a in sys.argv[1:]]  # e.g. semantic:pause
    for config_name, tape_name in combos:
        print(f"--- {config_name} / {tape_name} ---", flush=True)
        log = asyncio.run(run(config_name, tape_name))
        p = OUT / f"{config_name}-{tape_name}.json"
        p.write_text(json.dumps(log, indent=1))
        interesting = [e for e in log["events"] if e["type"] in (
            "input_audio_buffer.speech_started", "input_audio_buffer.speech_stopped",
            "input_audio_buffer.committed", "response.created", "response.done",
            "first_audio_delta", "error")]
        for e in interesting:
            print(f"  t={e['t']:>6}ms {e['type']}"
                  + (f"  status={e.get('status')} say={e.get('transcript','')!r}"
                     if e["type"] == "response.done" else "")
                  + (f"  {e.get('error')}" if e["type"] == "error" else ""), flush=True)
        for m in log["marks"]:
            pass  # marks are in the JSON; keep stdout compact
        print(f"  wrote {p}", flush=True)


if __name__ == "__main__":
    main()
