from __future__ import annotations
import asyncio, base64, json, os, time, tomllib
from pathlib import Path
from typing import AsyncIterator
import websockets
from .base import SessionEvent

CONFIG = Path(__file__).resolve().parents[3] / "config" / "bakeoff.toml"


def load_bakeoff_config() -> dict:
    return tomllib.loads(CONFIG.read_text())


class OpenAIProbe:
    """OpenAI Realtime over WebSocket (probe-scope; production uses WebRTC)."""
    name = "openai"
    input_sample_rate = 24000
    output_sample_rate = 24000

    # Wire names isolated here — verify against docs before first live run (Task 4 Step 1).
    WIRE = {
        "audio_delta": "response.output_audio.delta",
        "response_done": "response.done",
        "speech_started": "input_audio_buffer.speech_started",
        "speech_stopped": "input_audio_buffer.speech_stopped",
        "error": "error",
    }
    URL = "wss://api.openai.com/v1/realtime?model={model}"

    def __init__(self, model: str | None = None, vad: bool = False, api_key: str | None = None):
        cfg = load_bakeoff_config()
        self.model = model or cfg["openai"]["realtime_model"]
        self.vad = vad
        self.api_key = api_key or os.environ["OPENAI_API_KEY"]
        self._q: asyncio.Queue[SessionEvent | None] = asyncio.Queue()
        self._t0 = 0.0
        self._turn = 0

    # -- pure helpers (unit-tested) --
    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000.0

    def _map_wire(self, msg: dict) -> SessionEvent | None:
        t = msg.get("type", "")
        table = {
            self.WIRE["audio_delta"]: "audio.delta",
            self.WIRE["response_done"]: "audio.done",
            self.WIRE["speech_started"]: "input.speech_started",
            self.WIRE["speech_stopped"]: "input.speech_stopped",
            self.WIRE["error"]: "session.error",
        }
        kind = table.get(t)
        if kind is None:
            return None
        payload = {"raw_type": t}
        if kind == "audio.delta" and msg.get("delta"):
            payload["pcm"] = base64.b64decode(msg["delta"])
        return SessionEvent(self._now_ms(), kind, payload)

    def _session_update(self, instructions: str) -> str:
        session: dict = {"instructions": instructions, "modalities": ["audio", "text"]}
        if not self.vad:
            session["turn_detection"] = None
        return json.dumps({"type": "session.update", "session": session})

    @staticmethod
    def _turn_detection_off(msg: dict) -> bool:
        return msg["session"].get("turn_detection") is None

    # -- transport --
    async def connect(self, instructions: str) -> None:
        self._ws = await websockets.connect(
            self.URL.format(model=self.model),
            additional_headers={"Authorization": f"Bearer {self.api_key}"},
            max_size=None,
        )
        self._t0 = time.monotonic()
        await self._ws.send(self._session_update(instructions))
        await self._q.put(SessionEvent(0.0, "session.open", {"model": self.model}))
        self._reader = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                e = self._map_wire(json.loads(raw))
                if e:
                    await self._q.put(e)
        except websockets.ConnectionClosed as exc:
            await self._q.put(SessionEvent(self._now_ms(), "session.close", {"code": exc.code}))
        finally:
            await self._q.put(None)

    async def send_audio(self, pcm16: bytes) -> None:
        await self._ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(pcm16).decode(),
        }))

    async def commit_and_respond(self) -> None:
        self._turn += 1
        await self._ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        await self._q.put(SessionEvent(self._now_ms(), "turn.commit", {"turn": self._turn}))
        await self._ws.send(json.dumps({"type": "response.create"}))

    async def events(self) -> AsyncIterator[SessionEvent]:
        while True:
            e = await self._q.get()
            if e is None:
                return
            yield e

    async def close(self) -> None:
        self._reader.cancel()
        await self._ws.close()
