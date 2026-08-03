"""F-37 resilience primitives: config, retry, deadline, memory, concurrency.

Every test here is offline and deterministic: sleeps are injected, the clock
is injected, and the memory probe reads a tmp_path tree instead of the real
/sys and /proc.
"""
from __future__ import annotations

import threading

import httpx
import pytest
from google.genai import errors as genai_errors

from scorer.resilience import (
    ConcurrencySlot,
    Deadline,
    DeadlineExceeded,
    MemoryTooLow,
    SlotUnavailable,
    available_memory_mb,
    call_with_retry,
    current_deadline,
    deadline_scope,
    is_transient,
    load_resilience_config,
    require_memory,
)


def _api_error(code: int) -> genai_errors.APIError:
    return genai_errors.APIError(code, {"error": {"message": "boom"}})


# ----------------------------------------------------------------- config


def test_resilience_config_loads_and_validates():
    cfg = load_resilience_config()
    assert cfg.scoring.max_concurrency == 1, (
        "measured peak scoring memory is ~1.6GB; two concurrent runs OOMed "
        "production once already"
    )
    assert cfg.retry.max_attempts >= 2
    assert cfg.scoring.deadline_s > 0
    assert cfg.compile.deadline_s > 0
    assert cfg.deadletter.max_records > 0


def test_turning_a_config_knob_changes_what_the_retry_actually_does(monkeypatch):
    """The whole point of the file: no tuning knob is a code literal.

    Asserting the loaded values are non-None proves nothing -- a validated
    model cannot produce None. What has to be true is that an operator
    editing resilience.toml changes behaviour without a code change, so this
    moves the knob and watches the retry follow it.
    """
    import scorer.resilience as resilience_module

    cfg = load_resilience_config()
    patched = cfg.model_copy(update={
        "retry": cfg.retry.model_copy(update={"max_attempts": 2}),
    })
    monkeypatch.setattr(resilience_module, "load_resilience_config",
                        lambda: patched)
    attempts = {"n": 0}

    def always_429():
        attempts["n"] += 1
        raise _api_error(429)

    with pytest.raises(genai_errors.APIError):
        # No explicit policy: this is the path every production call site
        # takes, so it is the one that has to read the file.
        call_with_retry(always_429, what="probe", sleep=lambda _s: None,
                        jitter=lambda: 0.0)

    assert attempts["n"] == 2, "the call site ignored the configured budget"


# ------------------------------------------------------- transient classes


@pytest.mark.parametrize("code", [429, 500, 502, 503, 504])
def test_api_pressure_and_outage_codes_are_transient(code):
    assert is_transient(_api_error(code)) is True


@pytest.mark.parametrize("code", [400, 401, 403, 404, 422])
def test_client_error_codes_are_not_transient(code):
    assert is_transient(_api_error(code)) is False


def test_transport_and_timeout_failures_are_transient():
    assert is_transient(httpx.ConnectError("dns")) is True
    assert is_transient(httpx.ReadTimeout("slow")) is True
    assert is_transient(TimeoutError("slow")) is True
    assert is_transient(ConnectionResetError("peer")) is True


def test_programming_errors_are_never_transient():
    assert is_transient(ValueError("bad json")) is False
    assert is_transient(KeyError("missing")) is False


# -------------------------------------------------------------- retry


def test_retry_returns_the_first_successful_value_without_sleeping():
    slept: list[float] = []
    result = call_with_retry(lambda: "ok", what="probe", sleep=slept.append)
    assert result == "ok"
    assert slept == []


def test_retry_recovers_from_a_transient_failure():
    attempts = {"n": 0}
    slept: list[float] = []

    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise _api_error(429)
        return "recovered"

    result = call_with_retry(flaky, what="probe", sleep=slept.append, jitter=lambda: 0.0)
    assert result == "recovered"
    assert attempts["n"] == 3
    assert slept == [1.0, 2.0], "backoff must grow, not hammer a pressured API"


def test_retry_gives_up_after_the_configured_attempts():
    attempts = {"n": 0}

    def always_429():
        attempts["n"] += 1
        raise _api_error(429)

    with pytest.raises(genai_errors.APIError):
        call_with_retry(always_429, what="probe", sleep=lambda _s: None,
                        jitter=lambda: 0.0)
    assert attempts["n"] == load_resilience_config().retry.max_attempts


def test_retry_reraises_a_non_transient_failure_immediately():
    attempts = {"n": 0}

    def broken():
        attempts["n"] += 1
        raise ValueError("the model returned nonsense")

    with pytest.raises(ValueError):
        call_with_retry(broken, what="probe", sleep=lambda _s: None)
    assert attempts["n"] == 1, "a bug must not be retried three times"


def test_retry_backoff_is_capped():
    cfg = load_resilience_config().retry
    wide = cfg.model_copy(update={"max_attempts": 8, "max_backoff_s": 5.0})
    slept: list[float] = []
    with pytest.raises(genai_errors.APIError):
        call_with_retry(lambda: (_ for _ in ()).throw(_api_error(503)),
                        what="probe", retry=wide, sleep=slept.append,
                        jitter=lambda: 0.0)
    assert max(slept) <= 5.0


def test_retry_jitter_is_applied_within_the_configured_ratio():
    cfg = load_resilience_config().retry
    slept: list[float] = []
    attempts = {"n": 0}

    def flaky():
        attempts["n"] += 1
        if attempts["n"] < 2:
            raise _api_error(503)
        return "ok"

    call_with_retry(flaky, what="probe", sleep=slept.append, jitter=lambda: 1.0)
    assert slept == [pytest.approx(cfg.initial_backoff_s * (1 + cfg.jitter_ratio))]


# ------------------------------------------------------------- deadline


def test_deadline_reports_remaining_time_and_expiry():
    clock = {"t": 100.0}
    deadline = Deadline(10.0, monotonic=lambda: clock["t"])
    assert deadline.remaining_s == pytest.approx(10.0)
    assert deadline.expired is False
    clock["t"] = 111.0
    assert deadline.expired is True
    assert deadline.remaining_s == 0.0


def test_deadline_check_raises_with_the_step_name():
    clock = {"t": 0.0}
    deadline = Deadline(5.0, monotonic=lambda: clock["t"])
    deadline.check("transcribe")
    clock["t"] = 6.0
    with pytest.raises(DeadlineExceeded) as exc:
        deadline.check("content-judge")
    assert "content-judge" in str(exc.value)


def test_deadline_scope_binds_and_clears_the_context_var():
    assert current_deadline() is None
    with deadline_scope(30.0) as deadline:
        assert current_deadline() is deadline
    assert current_deadline() is None


def test_retry_refuses_to_start_an_attempt_past_the_deadline():
    clock = {"t": 0.0}
    calls = {"n": 0}

    def slow():
        calls["n"] += 1
        clock["t"] = 99.0
        raise _api_error(503)

    with deadline_scope(10.0, monotonic=lambda: clock["t"]):
        with pytest.raises(DeadlineExceeded):
            call_with_retry(slow, what="transcribe", sleep=lambda _s: None,
                            jitter=lambda: 0.0)
    assert calls["n"] == 1, (
        "a job that has run out of time must not buy another 480s call"
    )


def test_retry_does_not_sleep_past_the_deadline():
    clock = {"t": 0.0}
    slept: list[float] = []

    def flaky():
        raise _api_error(503)

    # 0.5s left, but the first backoff is 1s: retrying would blow the budget.
    with deadline_scope(0.5, monotonic=lambda: clock["t"]):
        with pytest.raises(DeadlineExceeded):
            call_with_retry(flaky, what="probe", sleep=slept.append,
                            jitter=lambda: 0.0)
    assert slept == []


# --------------------------------------------------------------- memory


def _write(root, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def test_memory_probe_prefers_the_cgroup_v2_container_limit(tmp_path):
    _write(tmp_path, "sys/fs/cgroup/memory.max", str(2 * 1024**3))
    _write(tmp_path, "sys/fs/cgroup/memory.current", str(1024**3))
    _write(tmp_path, "proc/meminfo", "MemAvailable:   999999999 kB\n")
    assert available_memory_mb(root=tmp_path) == pytest.approx(1024.0)


def test_memory_probe_falls_back_to_cgroup_v1(tmp_path):
    _write(tmp_path, "sys/fs/cgroup/memory/memory.limit_in_bytes",
           str(4 * 1024**3))
    _write(tmp_path, "sys/fs/cgroup/memory/memory.usage_in_bytes",
           str(3 * 1024**3))
    assert available_memory_mb(root=tmp_path) == pytest.approx(1024.0)


def test_memory_probe_falls_back_to_meminfo_when_the_cgroup_is_unlimited(tmp_path):
    _write(tmp_path, "sys/fs/cgroup/memory.max", "max")
    _write(tmp_path, "proc/meminfo",
           "MemTotal:       8000000 kB\nMemAvailable:    2048000 kB\n")
    assert available_memory_mb(root=tmp_path) == pytest.approx(2000.0)


def test_memory_probe_returns_none_when_nothing_is_readable(tmp_path):
    assert available_memory_mb(root=tmp_path) is None, (
        "an unmeasurable host must be honest, not guess a number"
    )


def test_memory_guard_refuses_a_job_under_the_floor(tmp_path):
    _write(tmp_path, "sys/fs/cgroup/memory.max", str(2 * 1024**3))
    _write(tmp_path, "sys/fs/cgroup/memory.current", str(2 * 1024**3 - 100 * 1024**2))
    with pytest.raises(MemoryTooLow) as exc:
        require_memory(512.0, what="scoring", root=tmp_path)
    assert "512" in str(exc.value) and "100" in str(exc.value)


def test_memory_guard_admits_a_job_with_headroom_and_reports_the_figure(tmp_path):
    _write(tmp_path, "sys/fs/cgroup/memory.max", str(2 * 1024**3))
    _write(tmp_path, "sys/fs/cgroup/memory.current", str(1024**3))
    assert require_memory(512.0, what="scoring", root=tmp_path) == pytest.approx(1024.0)


def test_memory_guard_stands_down_when_memory_is_unmeasurable(tmp_path):
    assert require_memory(4096.0, what="scoring", root=tmp_path) is None


def test_memory_guard_is_off_at_a_zero_floor(tmp_path):
    _write(tmp_path, "sys/fs/cgroup/memory.max", str(1024**3))
    _write(tmp_path, "sys/fs/cgroup/memory.current", str(1024**3))
    assert require_memory(0.0, what="compile", root=tmp_path) == pytest.approx(0.0)


# ---------------------------------------------------------- concurrency


def test_concurrency_slot_admits_up_to_the_limit():
    slot = ConcurrencySlot(2, wait_s=0.0, name="scoring")
    with slot.acquire():
        with slot.acquire():
            assert slot.in_flight == 2
    assert slot.in_flight == 0


def test_concurrency_slot_refuses_over_the_limit_after_the_wait():
    slot = ConcurrencySlot(1, wait_s=0.01, name="scoring")
    with slot.acquire():
        with pytest.raises(SlotUnavailable) as exc:
            with slot.acquire():
                pass
        assert "scoring" in str(exc.value)


def test_concurrency_slot_releases_on_failure():
    slot = ConcurrencySlot(1, wait_s=0.0, name="scoring")
    with pytest.raises(RuntimeError):
        with slot.acquire():
            raise RuntimeError("job blew up")
    assert slot.in_flight == 0
    with slot.acquire():
        pass


def test_concurrency_slot_serialises_real_threads():
    slot = ConcurrencySlot(1, wait_s=5.0, name="scoring")
    peak = {"value": 0}
    lock = threading.Lock()

    def work():
        with slot.acquire():
            with lock:
                peak["value"] = max(peak["value"], slot.in_flight)

    threads = [threading.Thread(target=work) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert peak["value"] == 1
