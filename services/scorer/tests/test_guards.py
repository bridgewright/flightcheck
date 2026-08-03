"""Tests for scorer.api.guards -- pure in-process guard primitives."""
from scorer.api.guards import AttemptCounter, FixedWindowLimiter


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_limiter_allows_up_to_the_budget_then_refuses():
    limiter = FixedWindowLimiter(window_s=60.0, per_window=3, clock=FakeClock())
    assert [limiter.hit("user-1") for _ in range(4)] == [True, True, True, False]


def test_limiter_keys_are_independent():
    limiter = FixedWindowLimiter(window_s=60.0, per_window=1, clock=FakeClock())
    assert limiter.hit("user-1") is True
    assert limiter.hit("user-2") is True
    assert limiter.hit("user-1") is False


def test_limiter_window_rollover_resets_the_budget():
    clock = FakeClock()
    limiter = FixedWindowLimiter(window_s=60.0, per_window=1, clock=clock)
    assert limiter.hit("user-1") is True
    assert limiter.hit("user-1") is False
    clock.advance(59.9)
    assert limiter.hit("user-1") is False   # still inside the window
    clock.advance(0.1)
    assert limiter.hit("user-1") is True    # window elapsed: fresh budget


def test_limiter_refused_hits_never_extend_the_window():
    # A fixed window (not a sliding one): hammering a refused key must not
    # postpone the reset, or a bursty client could lock itself out forever.
    clock = FakeClock()
    limiter = FixedWindowLimiter(window_s=60.0, per_window=1, clock=clock)
    assert limiter.hit("user-1") is True
    for _ in range(10):
        clock.advance(5.0)
        limiter.hit("user-1")
    clock.advance(10.0)                     # 60s after the FIRST hit
    assert limiter.hit("user-1") is True


def test_attempt_counter_counts_per_key():
    counter = AttemptCounter()
    assert counter.bump("sess-1") == 1
    assert counter.bump("sess-1") == 2
    assert counter.bump("sess-2") == 1
    assert counter.bump("sess-1") == 3
