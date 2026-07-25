from __future__ import annotations
import asyncio, os, time
from typing import AsyncIterator
from google import genai
from google.genai import types
from .base import SessionEvent
from .openai_probe import load_bakeoff_config


class GeminiProbe:
    """Gemini Live API probe. Input 16 kHz pcm16, output 24 kHz.

    Verified against installed google-genai==2.14.0 (google/genai/types.py,
    google/genai/live.py) and ai.google.dev/gemini-api Live API docs on
    2026-07-25. `LiveConnectConfig` field names (response_modalities,
    system_instruction, session_resumption, realtime_input_config.
    automatic_activity_detection.disabled) and the 16kHz-in/24kHz-out sample
    rates match the brief with no drift. Two real drifts were found and fixed
    below (see comments at each site) rather than in `_live_config`/`_classify`,
    which are unit-tested as pure functions and are unchanged from the brief.
    """
    name = "gemini"
    input_sample_rate = 16000
    output_sample_rate = 24000

    def __init__(self, model: str | None = None, vad: bool = True, api_key: str | None = None):
        cfg = load_bakeoff_config()
        self.model = model or cfg["gemini"]["realtime_model"]
        self.vad = vad
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self._q: asyncio.Queue[SessionEvent | None] = asyncio.Queue()
        self._t0 = 0.0
        self._turn = 0

    # -- pure helpers (unit-tested) --
    def _live_config(self, instructions: str) -> dict:
        cfg: dict = {
            "response_modalities": ["AUDIO"],
            "system_instruction": instructions,
            "session_resumption": {},          # ask server to issue resumption handles
        }
        if not self.vad:
            cfg["realtime_input_config"] = {"automatic_activity_detection": {"disabled": True}}
        return cfg

    @staticmethod
    def _classify(msg: dict) -> str | None:
        if msg.get("data"):
            return "audio.delta"
        if msg.get("server_content", {}).get("turn_complete"):
            return "audio.done"
        if "session_resumption_update" in msg:
            return "resumption.update"
        if msg.get("server_content", {}).get("interrupted"):
            return "input.speech_started"
        return None

    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000.0

    # -- transport --
    async def connect(self, instructions: str) -> None:
        self._client = genai.Client(api_key=self.api_key)
        self._cm = self._client.aio.live.connect(model=self.model, config=self._live_config(instructions))
        self._session = await self._cm.__aenter__()
        self._t0 = time.monotonic()
        await self._q.put(SessionEvent(0.0, "session.open", {"model": self.model}))
        self._reader = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            # Drift fix #1: `AsyncSession.receive()` is a single-turn generator —
            # it yields and then breaks as soon as server_content.turn_complete
            # arrives (google/genai/live.py `receive()`). A bare `async for`
            # over one `receive()` call would silently stop after the first
            # turn, even though `commit_and_respond()` expects multiple turns
            # per session. Re-enter `receive()` until the connection actually
            # closes/errors so every turn is observed.
            while True:
                async for msg in self._session.receive():
                    d = msg.model_dump(exclude_none=True) if hasattr(msg, "model_dump") else dict(msg)
                    # Drift fix #2: `LiveServerMessage.data` is a computed
                    # property (concatenated inline-audio bytes), not a
                    # pydantic field — it never appears in `model_dump()`
                    # output. Without this, `_classify`'s `msg.get("data")`
                    # check would never match a real audio delta, and
                    # audio.delta (the event this whole probe measures
                    # latency against) would never fire.
                    data = getattr(msg, "data", None)
                    if data is not None:
                        d["data"] = data
                    kind = self._classify(d)
                    if kind:
                        if kind == "resumption.update":
                            payload = {"handle": d["session_resumption_update"].get("new_handle")}
                        elif kind == "audio.delta":
                            payload = {"pcm": data}
                        else:
                            payload = {}
                        await self._q.put(SessionEvent(self._now_ms(), kind, payload))
        except Exception as exc:  # connection drop is a *measurement*, not a crash
            await self._q.put(SessionEvent(self._now_ms(), "session.close", {"error": repr(exc)}))
        finally:
            await self._q.put(None)

    async def send_audio(self, pcm16: bytes) -> None:
        await self._session.send_realtime_input(
            audio=types.Blob(data=pcm16, mime_type=f"audio/pcm;rate={self.input_sample_rate}")
        )

    async def commit_and_respond(self) -> None:
        self._turn += 1
        await self._q.put(SessionEvent(self._now_ms(), "turn.commit", {"turn": self._turn}))
        # Drift fix #3: audio_stream_end and ActivityEnd are not interchangeable.
        # The SDK's own docstring says audio_stream_end "should only be sent
        # when automatic activity detection is enabled (which is the
        # default)", while ActivityEnd "can only be sent if automatic ...
        # activity detection is disabled" (google/genai/types.py). `_live_config`
        # sets `automatic_activity_detection.disabled=True` when `self.vad` is
        # False, so that branch must send the matching manual-mode signal —
        # otherwise the server never receives a turn-end signal it accepts in
        # manual mode, and no response is ever generated for that turn.
        if self.vad:
            await self._session.send_realtime_input(audio_stream_end=True)
        else:
            await self._session.send_realtime_input(activity_end=types.ActivityEnd())

    async def events(self) -> AsyncIterator[SessionEvent]:
        while True:
            e = await self._q.get()
            if e is None:
                return
            yield e

    async def close(self) -> None:
        self._reader.cancel()
        await self._cm.__aexit__(None, None, None)
