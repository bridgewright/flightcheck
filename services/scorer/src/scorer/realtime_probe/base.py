"""Provider-agnostic probe interface for the S2S bake-off.

This layer exists so the bake-off measures *providers*, not our glue code.
Production transport (browser WebRTC) is separate; see DECISIONS.md #002.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol

# Canonical event kinds (adapters map provider wire events onto these):
# session.open | session.close | session.error | turn.commit
# audio.delta | audio.done | input.speech_started | input.speech_stopped
# text.delta | resumption.update


@dataclass
class SessionEvent:
    t_ms: float          # monotonic ms since connect()
    kind: str
    payload: dict = field(default_factory=dict)


class RealtimeProbe(Protocol):
    name: str
    input_sample_rate: int
    output_sample_rate: int

    async def connect(self, instructions: str) -> None: ...
    async def send_audio(self, pcm16: bytes) -> None: ...
    async def commit_and_respond(self) -> None: ...
    def events(self) -> AsyncIterator[SessionEvent]: ...
    async def close(self) -> None: ...


@dataclass
class TurnMetrics:
    turn: int
    t_commit_ms: float
    t_first_audio_ms: float

    @property
    def latency_ms(self) -> float:
        return self.t_first_audio_ms - self.t_commit_ms


def collect_turn_metrics(events: list[SessionEvent]) -> list[TurnMetrics]:
    """First audio.delta after each turn.commit defines that turn's latency."""
    out: list[TurnMetrics] = []
    pending: SessionEvent | None = None
    for e in events:
        if e.kind == "turn.commit":
            pending = e
        elif e.kind == "audio.delta" and pending is not None:
            out.append(TurnMetrics(
                turn=pending.payload.get("turn", len(out) + 1),
                t_commit_ms=pending.t_ms,
                t_first_audio_ms=e.t_ms,
            ))
            pending = None
    return out
