import numpy as np, soundfile as sf
from scorer.realtime_probe.audio_io import load_pcm16, chunked

def test_load_pcm16_resamples_and_mono(tmp_path):
    sr = 48000
    t = np.linspace(0, 1.0, sr, endpoint=False)
    stereo = np.stack([np.sin(2 * np.pi * 440 * t)] * 2, axis=1)
    f = tmp_path / "a.wav"
    sf.write(f, stereo, sr)
    pcm = load_pcm16(f, target_rate=16000)
    assert len(pcm) == 16000 * 2  # 1 s of mono int16 @16k

def test_chunked_200ms():
    pcm = b"\x00\x00" * 16000  # 1 s @16k
    chunks = chunked(pcm, rate=16000, chunk_ms=200)
    assert len(chunks) == 5 and all(len(c) == 16000 * 2 // 5 for c in chunks)
