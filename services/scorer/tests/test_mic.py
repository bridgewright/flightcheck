import queue

from scorer.realtime_probe.base import SessionEvent
from scorer.realtime_probe.fake import FakeProbe
from scorer.realtime_probe.mic import (
    FLUSH,
    OutputRing,
    backlog_cap_bytes,
    frames_to_chunks,
    make_output_callback,
    pump_events,
)

BLOCK = 9600  # 4800 int16 frames @24 kHz — what sounddevice asks for per callback


def test_frames_to_chunks_accumulates_until_chunk_size():
    frames = [b"\x00" * 100, b"\x00" * 100, b"\x00" * 100]
    chunks, buf = frames_to_chunks(frames, chunk_bytes=250)
    assert [len(c) for c in chunks] == [250]
    assert len(buf) == 50


def test_output_ring_reads_exactly_the_requested_length():
    ring = OutputRing()
    ring.write(b"\x01" * 10)
    assert ring.read(4) == b"\x01" * 4
    assert ring.read(4) == b"\x01" * 4
    assert ring.read(4) == b"\x01" * 2 + b"\x00" * 2   # zero-fill on true underrun
    assert ring.read(2) == b"\x00" * 2


def _callback_output(cb, nbytes: int = BLOCK) -> bytes:
    buf = bytearray(nbytes)
    cb(memoryview(buf), nbytes // 2, None, None)   # memoryview = sounddevice's exact-size buffer
    return bytes(buf)


def test_oversized_delta_is_played_across_callbacks():
    # A 0.3 s delta @24 kHz is 14400 bytes — bigger than one 9600-byte block.
    # Writing it straight into the callback buffer raised ValueError and killed
    # the whole output stream; the ring must carry the remainder to the next call.
    q: queue.Queue[bytes] = queue.Queue()
    q.put(b"\xaa" * 14400)
    cb = make_output_callback(q)
    assert _callback_output(cb) == b"\xaa" * BLOCK
    assert _callback_output(cb) == b"\xaa" * 4800 + b"\x00" * 4800


def test_small_deltas_are_concatenated_not_padded_with_silence():
    # Four 50 ms deltas fill exactly one block; the old one-delta-per-callback
    # path played each with 75% silence appended, shredding the interviewer.
    q: queue.Queue[bytes] = queue.Queue()
    for _ in range(4):
        q.put(b"\xbb" * 2400)
    cb = make_output_callback(q)
    assert _callback_output(cb) == b"\xbb" * BLOCK


def test_callback_outputs_silence_when_nothing_is_queued():
    cb = make_output_callback(queue.Queue())
    assert _callback_output(cb) == b"\x00" * BLOCK


# -- barge-in (R2-2): the interviewer must stop the moment the candidate speaks --

def test_output_ring_flush_drops_everything_buffered():
    # Interruption naturalness is measured by how fast the interviewer goes
    # quiet, and buffered audio keeps playing long after the model stopped
    # sending — so a barge-in has to drop mid-buffer, not just stop refilling.
    ring = OutputRing()
    ring.write(b"\x01" * 10)
    ring.flush()
    assert ring.read(4) == b"\x00" * 4


def test_output_ring_drops_oldest_audio_beyond_the_backlog_cap():
    # Providers send faster than real time; without a cap the ring accumulates
    # seconds of lag and the interviewer answers questions from a minute ago.
    ring = OutputRing(max_bytes=10)
    ring.write(b"\xaa" * 6)
    ring.write(b"\xbb" * 8)
    assert ring.read(10) == b"\xaa" * 2 + b"\xbb" * 8   # newest 10 bytes survive
    assert ring.read(2) == b"\x00" * 2                  # nothing else was kept


def test_backlog_cap_is_thirty_seconds_of_output_audio():
    assert backlog_cap_bytes(24000) == 24000 * 2 * 30   # 30 s of 24 kHz pcm16


def test_queued_flush_drops_audio_buffered_before_it_and_keeps_what_follows():
    # The flush travels through out_q instead of a shared flag: deltas that
    # arrive *after* the barge-in must survive, which a "clear the queue"
    # flag racing the audio thread cannot guarantee.
    q: queue.Queue = queue.Queue()
    q.put(b"\xaa" * BLOCK)
    q.put(FLUSH)
    q.put(b"\xbb" * 2400)
    cb = make_output_callback(q)
    assert _callback_output(cb) == b"\xbb" * 2400 + b"\x00" * (BLOCK - 2400)


async def test_speech_started_flushes_the_interviewer_audio_queued_before_it(tmp_path):
    script = [
        SessionEvent(0.0, "audio.delta", {"pcm": b"\xaa" * BLOCK}),
        SessionEvent(10.0, "input.speech_started", {}),        # candidate barges in
        SessionEvent(20.0, "audio.delta", {"pcm": b"\xbb" * BLOCK}),
    ]
    q: queue.Queue = queue.Queue()
    await pump_events(FakeProbe(script), q, tmp_path / "mic.jsonl")
    cb = make_output_callback(q)
    # the block queued before the barge-in never reaches the device
    assert _callback_output(cb) == b"\xbb" * BLOCK
