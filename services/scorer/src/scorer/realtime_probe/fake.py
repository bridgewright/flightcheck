from __future__ import annotations
from typing import AsyncIterator
from .base import SessionEvent


class FakeProbe:
    """Replays a scripted event list. Used by scenario-runner and report tests."""
    name = "fake"
    input_sample_rate = 16000
    output_sample_rate = 24000

    def __init__(self, script: list[SessionEvent]):
        self._script = script
        self.sent_audio: list[bytes] = []
        self.commits = 0
        self.connected_with: str | None = None

    async def connect(self, instructions: str) -> None:
        self.connected_with = instructions

    async def send_audio(self, pcm16: bytes) -> None:
        self.sent_audio.append(pcm16)

    async def commit_and_respond(self) -> None:
        self.commits += 1

    async def events(self) -> AsyncIterator[SessionEvent]:
        for e in self._script:
            yield e

    async def close(self) -> None:
        pass
