from __future__ import annotations

import asyncio
import os
import time
from collections.abc import AsyncIterator
from typing import ClassVar

from google import genai
from google.genai import types

from .base import SessionEvent
from .openai_probe import load_bakeoff_config

# Websocket close codes that mean "the protocol ended this connection", not
# "something broke": normal closure and going-away (the go_away path Gemini
# uses when a live session reaches its cap).
CLEAN_CLOSE_CODES = frozenset({1000, 1001})


class GeminiProbe:
    """Gemini Live API probe. Input 16 kHz pcm16, output 24 kHz.

    Verified against installed google-genai==2.14.0 (google/genai/types.py,
    google/genai/live.py) and ai.google.dev/gemini-api Live API docs on
    2026-07-25. `LiveConnectConfig` field names (response_modalities,
    system_instruction, session_resumption, realtime_input_config.
    automatic_activity_detection.disabled) and the 16kHz-in/24kHz-out sample
    rates match the brief with no drift. Three real drifts were found and fixed
    below (see comments at each site).

    The session also resumes itself: Gemini live audio sessions are capped
    (~15 min; the websocket is sent away around 10 min), so the probe stores the
    handles the server issues and reconnects with the newest one, on a single
    continuous event stream, whenever a session drops (`_resume`) — and, when
    the server announces the close first (`go_away`), at the next turn boundary
    *before* it drops, so sends never meet a dead session.
    """
    name = "gemini"
    input_sample_rate = 16000
    output_sample_rate = 24000
    resumable = True        # `_resume` reconnects and emits session.resumed
    # A resumption loop that never converges would spin forever; a 22-minute
    # run needs ~2 resumptions, so this only ever bites on a broken server.
    MAX_RESUMPTIONS: ClassVar[int] = 20

    def __init__(self, model: str | None = None, vad: bool = True, api_key: str | None = None):
        cfg = load_bakeoff_config()
        self.model = model or cfg["gemini"]["realtime_model"]
        self.vad = vad
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self._q: asyncio.Queue[SessionEvent | None] = asyncio.Queue()
        self._t0 = 0.0
        self._turn = 0
        self._instructions = ""
        self._handle: str | None = None
        self._resumptions = 0
        self._closing = False
        self._go_away = False

    # -- pure helpers (unit-tested) --
    def _live_config(self, instructions: str, handle: str | None = None) -> dict:
        cfg: dict = {
            "response_modalities": ["AUDIO"],
            "system_instruction": instructions,
            # empty dict = ask the server to issue resumption handles;
            # {"handle": h} = resume the session that handle points at.
            "session_resumption": {"handle": handle} if handle else {},
        }
        if not self.vad:
            cfg["realtime_input_config"] = {"automatic_activity_detection": {"disabled": True}}
        return cfg

    @staticmethod
    def _close_kind(exc: BaseException) -> str:
        """Clean protocol close vs error close (the SDK reports both as APIError)."""
        return ("session.close" if getattr(exc, "code", None) in CLEAN_CLOSE_CODES
                else "session.error")

    @staticmethod
    def _classify(msg: dict) -> str | None:
        if msg.get("data"):
            return "audio.delta"
        if msg.get("server_content", {}).get("turn_complete"):
            return "audio.done"
        if "session_resumption_update" in msg:
            return "resumption.update"
        # `LiveServerGoAway.time_left` is Optional, so an announced close can
        # dump as an empty dict — presence of the key is the signal, not truth.
        if "go_away" in msg:
            return "session.going_away"
        if msg.get("server_content", {}).get("interrupted"):
            return "input.speech_started"
        return None

    def _now_ms(self) -> float:
        return (time.monotonic() - self._t0) * 1000.0

    # -- transport --
    async def connect(self, instructions: str) -> None:
        self._instructions = instructions
        self._client = genai.Client(api_key=self.api_key)
        await self._open_session()
        self._t0 = time.monotonic()
        await self._q.put(SessionEvent(0.0, "session.open", {"model": self.model}))
        self._reader = asyncio.create_task(self._read_loop())

    async def _open_session(self, handle: str | None = None) -> None:
        self._cm = self._client.aio.live.connect(
            model=self.model, config=self._live_config(self._instructions, handle))
        self._session = await self._cm.__aenter__()

    async def _close_session(self) -> None:
        """Best-effort teardown — the socket we are closing is usually already dead."""
        try:
            await self._cm.__aexit__(None, None, None)
        except Exception:  # noqa: BLE001 — teardown of a broken socket must never mask the drop
            pass

    async def _resume(self) -> bool:
        """Reconnect with the stored handle, keeping one continuous event stream.

        Gemini live audio sessions are capped (~15 min; the websocket goes away
        near 10 min), so a 22-minute stability run *must* resume or it measures
        the protocol's cap instead of the provider's stability. `self._t0` is
        deliberately not reset: latency timestamps stay on one timeline.
        """
        if self._resumptions >= self.MAX_RESUMPTIONS:
            return False
        handle = self._handle
        await self._close_session()
        try:
            await self._open_session(handle)
        except Exception as exc:  # noqa: BLE001 — any resume failure ends the run, not the process
            await self._q.put(SessionEvent(self._now_ms(), "session.error",
                                           {"error": repr(exc), "phase": "resume"}))
            return False
        self._resumptions += 1
        await self._q.put(SessionEvent(self._now_ms(), "session.resumed", {"handle": handle}))
        return True

    async def _read_loop(self) -> None:
        try:
            while True:
                try:
                    # Drift fix #1: `AsyncSession.receive()` is a single-turn
                    # generator — it yields and then breaks as soon as
                    # server_content.turn_complete arrives (google/genai/live.py
                    # `receive()`). A bare `async for` over one `receive()` call
                    # would silently stop after the first turn, even though
                    # `commit_and_respond()` expects multiple turns per session.
                    # Re-enter `receive()` until the connection actually
                    # closes/errors so every turn is observed.
                    while True:
                        async for msg in self._session.receive():
                            await self._emit(msg)
                        if self._go_away:
                            # The server announces the close (go_away, carrying
                            # time_left) before it happens. Reconnecting here —
                            # at a turn boundary, while the socket is still
                            # alive — keeps the window in which a send hits a
                            # dead session down to ~nothing, instead of the
                            # seconds it takes to notice a socket that already
                            # died. Without a handle there is nothing to resume
                            # into (a fresh session would silently drop the
                            # interview's context), so ride the socket down.
                            self._go_away = False
                            if self._handle and not await self._resume():
                                return
                except Exception as exc:  # noqa: BLE001 — a drop is a *measurement*, not a crash
                    # The SDK raises APIError carrying the websocket close code
                    # for every disconnect, so clean and failed closes are only
                    # distinguishable here, by code.
                    await self._q.put(SessionEvent(self._now_ms(), self._close_kind(exc),
                                                   {"error": repr(exc)}))
                    if self._closing or not self._handle or not await self._resume():
                        return
        finally:
            await self._q.put(None)

    async def _emit(self, msg) -> None:
        d = msg.model_dump(exclude_none=True) if hasattr(msg, "model_dump") else dict(msg)
        # Drift fix #2: `LiveServerMessage.data` is a computed property
        # (concatenated inline-audio bytes), not a pydantic field — it never
        # appears in `model_dump()` output. Without this, `_classify`'s
        # `msg.get("data")` check would never match a real audio delta, and
        # audio.delta (the event this whole probe measures latency against)
        # would never fire.
        data = getattr(msg, "data", None)
        if data is not None:
            d["data"] = data
        kind = self._classify(d)
        if not kind:
            return
        if kind == "resumption.update":
            handle = d["session_resumption_update"].get("new_handle")
            if handle:  # empty new_handle means "not resumable right now"
                self._handle = handle
            payload = {"handle": handle}
        elif kind == "audio.delta":
            payload = {"pcm": data}
        elif kind == "session.going_away":
            # Acted on in `_read_loop`, not here: `_emit` runs inside the
            # `receive()` generator, and reconnecting under it would tear down
            # the socket being iterated.
            self._go_away = True
            payload = {"time_left": str(d["go_away"].get("time_left"))}
        else:
            payload = {}
        await self._q.put(SessionEvent(self._now_ms(), kind, payload))

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
        self._closing = True          # an intentional close must not trigger a resume
        self._reader.cancel()
        await self._close_session()
