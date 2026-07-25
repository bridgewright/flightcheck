import queue

from scorer.realtime_probe.mic import OutputRing, frames_to_chunks, make_output_callback

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
