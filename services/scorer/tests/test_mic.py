from scorer.realtime_probe.mic import frames_to_chunks

def test_frames_to_chunks_accumulates_until_chunk_size():
    frames = [b"\x00" * 100, b"\x00" * 100, b"\x00" * 100]
    chunks, buf = frames_to_chunks(frames, chunk_bytes=250)
    assert [len(c) for c in chunks] == [250]
    assert len(buf) == 50
