from __future__ import annotations
from pathlib import Path
import numpy as np
import soundfile as sf


def load_pcm16(path: Path, target_rate: int) -> bytes:
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != target_rate:
        n_out = int(len(mono) * target_rate / sr)
        x_old = np.linspace(0, 1, len(mono), endpoint=False)
        x_new = np.linspace(0, 1, n_out, endpoint=False)
        mono = np.interp(x_new, x_old, mono)
    return (np.clip(mono, -1, 1) * 32767).astype("<i2").tobytes()


def chunked(pcm: bytes, rate: int, chunk_ms: int = 200) -> list[bytes]:
    step = rate * 2 * chunk_ms // 1000
    return [pcm[i:i + step] for i in range(0, len(pcm), step)]
