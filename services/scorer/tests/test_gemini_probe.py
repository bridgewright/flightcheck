import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from google.genai import errors, types

from scorer.realtime_probe import gemini_probe
from scorer.realtime_probe.gemini_probe import GeminiProbe


def test_live_config_requests_audio_and_resumption():
    p = GeminiProbe(model="gemini-2.5-flash-native-audio-preview-09-2025")
    cfg = p._live_config("Be a tough interviewer.")
    assert cfg["response_modalities"] == ["AUDIO"]
    assert "session_resumption" in cfg
    assert "tough interviewer" in str(cfg["system_instruction"])


def test_live_config_carries_resumption_handle_when_resuming():
    p = GeminiProbe()
    assert p._live_config("x")["session_resumption"] == {}
    assert p._live_config("x", handle="h1")["session_resumption"] == {"handle": "h1"}


def test_server_message_mapping():
    p = GeminiProbe()
    assert p._classify({"data": b"\x00\x01"}) == "audio.delta"
    assert p._classify({"server_content": {"turn_complete": True}}) == "audio.done"
    assert p._classify({"session_resumption_update": {"new_handle": "h1"}}) == "resumption.update"
    assert p._classify({"setup_complete": {}}) is None


def test_go_away_is_classified_so_the_probe_can_reconnect_before_the_socket_dies():
    # `LiveServerGoAway.time_left` may be None, so the *presence* of the field —
    # not its truthiness — is the signal (model_dump leaves an empty dict).
    p = GeminiProbe()
    assert p._classify({"go_away": {"time_left": "10s"}}) == "session.going_away"
    assert p._classify({"go_away": {}}) == "session.going_away"


def test_send_audio_emits_activity_start_once_per_turn_when_vad_disabled():
    # Drift fix #4: `automatic_activity_detection.disabled=True` means "the
    # client must send activity signals" (google/genai/types.py, field
    # docstring on `AutomaticActivityDetection.disabled`). Without an explicit
    # `activity_start` before the first audio chunk of a turn, the server has
    # no signal that user activity has begun and never processes the audio —
    # the manual-mode turn silently produces zero responses. `_live_config`
    # already disables auto-detection for vad=False; `send_audio` must open
    # the turn with `activity_start` exactly once, lazily, before the first
    # audio blob of each turn. Because `send_realtime_input` only accepts one
    # argument per call (google/genai/live.py: "Only one argument can be set"),
    # activity_start must be its own call, not bundled with the audio.
    p = GeminiProbe(vad=False)
    p._session = AsyncMock()

    asyncio.run(p.send_audio(b"pcm1"))
    calls = p._session.send_realtime_input.call_args_list
    assert len(calls) == 2
    assert calls[0].kwargs == {"activity_start": types.ActivityStart()}
    assert isinstance(calls[1].kwargs.get("audio"), types.Blob)

    # second chunk of the same (still-open) turn must not repeat activity_start
    p._session.send_realtime_input.reset_mock()
    asyncio.run(p.send_audio(b"pcm2"))
    calls = p._session.send_realtime_input.call_args_list
    assert len(calls) == 1
    assert isinstance(calls[0].kwargs.get("audio"), types.Blob)

    # commit_and_respond closes the turn (activity_end) — the next send_audio
    # must open a fresh turn with activity_start again
    asyncio.run(p.commit_and_respond())
    p._session.send_realtime_input.reset_mock()
    asyncio.run(p.send_audio(b"pcm3"))
    calls = p._session.send_realtime_input.call_args_list
    assert len(calls) == 2
    assert calls[0].kwargs == {"activity_start": types.ActivityStart()}
    assert isinstance(calls[1].kwargs.get("audio"), types.Blob)


def test_send_audio_never_emits_activity_start_when_vad_enabled():
    # Automatic (server-side) activity detection is on for vad=True, and the
    # SDK docstring says activity_start/activity_end "can only be sent if
    # automatic ... activity detection is disabled" — sending them here would
    # be rejected by the server, so this path must never emit them.
    p = GeminiProbe(vad=True)
    p._session = AsyncMock()

    asyncio.run(p.send_audio(b"pcm1"))
    asyncio.run(p.commit_and_respond())
    asyncio.run(p.send_audio(b"pcm2"))

    calls = p._session.send_realtime_input.call_args_list
    assert all("activity_start" not in c.kwargs for c in calls)
    assert all("activity_end" not in c.kwargs for c in calls)


def test_commit_and_respond_sends_audio_stream_end_when_vad_enabled():
    # automatic_activity_detection is on (default) in this mode, so the SDK's
    # own docstring says audio_stream_end is the correct turn-end signal.
    p = GeminiProbe(vad=True)
    p._session = AsyncMock()
    asyncio.run(p.commit_and_respond())
    p._session.send_realtime_input.assert_awaited_once_with(audio_stream_end=True)


def test_commit_and_respond_sends_activity_end_when_vad_disabled():
    # _live_config sets automatic_activity_detection.disabled=True for
    # vad=False; the SDK docstring says audio_stream_end "should only be
    # sent when automatic activity detection is enabled" and ActivityEnd
    # "can only be sent if automatic ... activity detection is disabled" —
    # so manual mode must send activity_end instead, or the server never
    # gets a turn-end signal at all.
    p = GeminiProbe(vad=False)
    p._session = AsyncMock()
    asyncio.run(p.commit_and_respond())
    kwargs = p._session.send_realtime_input.call_args.kwargs
    assert "audio_stream_end" not in kwargs
    assert isinstance(kwargs.get("activity_end"), types.ActivityEnd)


def test_close_kind_separates_clean_protocol_close_from_error_close():
    # The SDK turns a websocket close into an APIError carrying the close code;
    # 1000/1001 (normal / going away, i.e. the go_away path) are protocol-clean,
    # everything else is a real failure and must not be filed as a plain close.
    assert GeminiProbe._close_kind(errors.APIError(1000, {})) == "session.close"
    assert GeminiProbe._close_kind(errors.APIError(1001, {})) == "session.close"
    assert GeminiProbe._close_kind(errors.APIError(1011, {})) == "session.error"
    assert GeminiProbe._close_kind(RuntimeError("boom")) == "session.error"


# -- reconnect-with-handle harness (mocked SDK session, no network) --

def _audio_msg(pcm: bytes = b"\x00\x01") -> types.LiveServerMessage:
    return types.LiveServerMessage(server_content=types.LiveServerContent(
        model_turn=types.Content(parts=[
            types.Part(inline_data=types.Blob(data=pcm, mime_type="audio/pcm"))])))


def _go_away_msg(time_left: str = "10s") -> types.LiveServerMessage:
    return types.LiveServerMessage(go_away=types.LiveServerGoAway(time_left=time_left))


def _handle_msg(handle: str) -> types.LiveServerMessage:
    return types.LiveServerMessage(
        session_resumption_update=types.LiveServerSessionResumptionUpdate(
            new_handle=handle, resumable=True))


class _FakeSession:
    """Mimics AsyncSession.receive(): one generator per model turn, then raises."""

    def __init__(self, turns, error):
        self._turns = [list(t) for t in turns]
        self._error = error

    async def receive(self):
        if not self._turns:
            raise self._error
        for msg in self._turns.pop(0):
            yield msg


class _FakeCM:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


class _FakeLive:
    def __init__(self, sessions):
        self._sessions = list(sessions)
        self.configs: list[dict] = []

    def connect(self, *, model, config):
        self.configs.append(config)
        return _FakeCM(self._sessions.pop(0))


def _fake_client(sessions):
    live = _FakeLive(sessions)
    return SimpleNamespace(aio=SimpleNamespace(live=live)), live


async def _drain(p: GeminiProbe) -> list:
    return [e async for e in p.events()]


async def test_read_loop_reconnects_with_stored_handle_after_drop(monkeypatch):
    # Gemini audio sessions are capped (~15 min; WS ~10 min with go_away). A
    # 22-minute stability run only stays valid if the probe resumes the session
    # with the handle the server issued, on one continuous event stream.
    first = _FakeSession([[_handle_msg("h1"), _audio_msg()]], errors.APIError(1000, {}))
    second = _FakeSession([[_audio_msg()]], errors.APIError(1000, {}))
    client, live = _fake_client([first, second])
    monkeypatch.setattr(gemini_probe.genai, "Client", lambda api_key=None: client)

    p = GeminiProbe(vad=False, api_key="k")
    p.MAX_RESUMPTIONS = 1          # second drop must not loop forever
    await p.connect("Be an interviewer.")
    events = await _drain(p)

    assert [e.kind for e in events] == [
        "session.open", "resumption.update", "audio.delta", "session.close",
        "session.resumed", "audio.delta", "session.close",
    ]
    assert len(live.configs) == 2
    assert live.configs[0]["session_resumption"] == {}
    assert live.configs[1]["session_resumption"] == {"handle": "h1"}
    assert [e.payload.get("handle") for e in events if e.kind == "session.resumed"] == ["h1"]
    # one continuous timeline: the clock is not restarted by the reconnect
    assert [e.t_ms for e in events] == sorted(e.t_ms for e in events)


async def test_go_away_reconnects_at_the_turn_boundary_before_the_socket_dies(monkeypatch):
    # The server announces the close (go_away with time_left) before it happens.
    # Reconnecting there — at a turn boundary, on a socket that is still alive —
    # shrinks the window in which sends hit a dead session to ~zero, and the run
    # never records a disconnect it did not actually suffer.
    first = _FakeSession([[_handle_msg("h1"), _audio_msg(), _go_away_msg()]],
                         errors.APIError(1000, {}))
    second = _FakeSession([[_audio_msg()]], errors.APIError(1000, {}))
    client, live = _fake_client([first, second])
    monkeypatch.setattr(gemini_probe.genai, "Client", lambda api_key=None: client)

    p = GeminiProbe(vad=False, api_key="k")
    p.MAX_RESUMPTIONS = 1
    await p.connect("x")
    events = await _drain(p)

    assert [e.kind for e in events] == [
        "session.open", "resumption.update", "audio.delta", "session.going_away",
        "session.resumed", "audio.delta", "session.close",
    ]
    assert live.configs[1]["session_resumption"] == {"handle": "h1"}


async def test_go_away_without_a_handle_does_not_open_a_context_free_session(monkeypatch):
    # Reconnecting without a handle would silently restart the interview with an
    # empty conversation; better to ride the socket down and report the drop.
    only = _FakeSession([[_audio_msg(), _go_away_msg()]], errors.APIError(1000, {}))
    client, live = _fake_client([only])
    monkeypatch.setattr(gemini_probe.genai, "Client", lambda api_key=None: client)

    p = GeminiProbe(vad=False, api_key="k")
    await p.connect("x")
    events = await _drain(p)

    assert [e.kind for e in events] == [
        "session.open", "audio.delta", "session.going_away", "session.close"]
    assert len(live.configs) == 1


async def test_read_loop_does_not_reconnect_without_a_handle(monkeypatch):
    only = _FakeSession([[_audio_msg()]], RuntimeError("socket died"))
    client, live = _fake_client([only])
    monkeypatch.setattr(gemini_probe.genai, "Client", lambda api_key=None: client)

    p = GeminiProbe(vad=False, api_key="k")
    await p.connect("x")
    events = await _drain(p)

    # no handle was ever issued → nothing to resume; the drop is an error close
    assert [e.kind for e in events] == ["session.open", "audio.delta", "session.error"]
    assert "socket died" in events[-1].payload["error"]
    assert len(live.configs) == 1
