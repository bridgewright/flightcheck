from scorer.realtime_probe.base import SessionEvent, collect_turn_metrics, count_attempted_turns
from scorer.realtime_probe.fake import FakeProbe


def test_latency_computed_per_turn():
    events = [
        SessionEvent(0.0, "session.open", {}),
        SessionEvent(1000.0, "turn.commit", {"turn": 1}),
        SessionEvent(1620.0, "audio.delta", {}),
        SessionEvent(3000.0, "audio.done", {}),
        SessionEvent(5000.0, "turn.commit", {"turn": 2}),
        SessionEvent(5410.0, "audio.delta", {}),
        SessionEvent(7000.0, "audio.done", {}),
    ]
    m = collect_turn_metrics(events)
    assert [round(x.latency_ms) for x in m] == [620, 410]


def test_latency_ignores_later_deltas_in_same_turn():
    events = [
        SessionEvent(0.0, "turn.commit", {"turn": 1}),
        SessionEvent(500.0, "audio.delta", {}),
        SessionEvent(900.0, "audio.delta", {}),
    ]
    m = collect_turn_metrics(events)
    assert len(m) == 1 and m[0].latency_ms == 500.0


def test_attempted_turns_counts_turns_that_were_never_answered():
    # A turn the provider never answered has no latency, so it vanishes from
    # collect_turn_metrics — exactly the failure a stability run must surface.
    events = [
        SessionEvent(0.0, "turn.commit", {"turn": 1}),
        SessionEvent(500.0, "audio.delta", {}),
        SessionEvent(900.0, "turn.commit", {"turn": 2}),
        SessionEvent(1500.0, "session.error", {"error": "boom"}),
    ]
    assert len(collect_turn_metrics(events)) == 1
    assert count_attempted_turns(events) == 2


async def test_fake_probe_replays_script():
    script = [SessionEvent(0.0, "session.open", {}), SessionEvent(10.0, "audio.delta", {})]
    probe = FakeProbe(script)
    await probe.connect("You are an interviewer.")
    got = [e async for e in probe.events()]
    assert [e.kind for e in got] == ["session.open", "audio.delta"]
