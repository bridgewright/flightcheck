"""In-process guard primitives: fixed-window rate limiter and attempt counter.

Deliberately in-memory: the worker runs as ONE uvicorn process on Railway,
so a process-local counter is a real per-key bound there. A deploy resets
the windows and counters; the durable backstops survive restarts -- the
per-account package ceiling and per-package session totals are row counts,
the secret-mint counter is a DB column, and the terminal-state transitions
the attempt caps trigger are status writes. These primitives bound the burst
abuse BETWEEN restarts; they are not billing records.
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable


class FixedWindowLimiter:
    """Per-key fixed-window rate limit: `per_window` hits per `window_s`.

    Fixed, not sliding: the window is anchored at the first counted hit and
    refused hits never extend it, so a bursty-but-honest client recovers as
    soon as one full window elapses. Thread-safe (FastAPI serves requests
    from a thread pool).
    """

    def __init__(self, window_s: float, per_window: int,
                 clock: Callable[[], float] = time.monotonic):
        self._window_s = window_s
        self._per_window = per_window
        self._clock = clock
        self._lock = threading.Lock()
        self._windows: dict[str, tuple[float, int]] = {}

    def hit(self, key: str) -> bool:
        """Count one hit for `key`; True when it fits the window's budget."""
        now = self._clock()
        with self._lock:
            start, count = self._windows.get(key, (now, 0))
            if now - start >= self._window_s:
                start, count = now, 0
            if count >= self._per_window:
                self._windows[key] = (start, count)
                return False
            self._windows[key] = (start, count + 1)
            return True


class AttemptCounter:
    """Monotonic per-key attempt count; bump returns the NEW total.

    Backs the resume/re-score/compile-retry caps. Process-local by design
    (see the module docstring): once a cap flips a row to its terminal
    status, THAT is the durable record -- the counter only decides when.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, int] = {}

    def bump(self, key: str) -> int:
        with self._lock:
            self._counts[key] = self._counts.get(key, 0) + 1
            return self._counts[key]
