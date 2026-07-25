"""Audio normalization: recordings arrive as webm; scoring needs 16 kHz wav.

Hard-won API fact (W1 bake-off): Gemini file uploads accept wav/mp3/aac/
ogg/flac but NOT webm, so every browser recording goes through ffmpeg
before any Gemini audio call. 16 kHz mono matches the DSP pipeline (Task 8).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

_STDERR_TAIL_CHARS = 500


class AudioConversionError(Exception):
    """ffmpeg exited nonzero while converting a recording to wav."""


def ensure_wav(path: Path) -> Path:
    """Return a 16 kHz mono wav path for `path`, converting when needed.

    A path already ending in .wav is returned unchanged. Anything else is
    converted with ffmpeg to <stem>.wav next to the input. On failure only
    the TAIL of ffmpeg's stderr goes into the exception -- never the full
    dump, which can echo the entire invocation environment into logs.
    """
    if path.suffix.lower() == ".wav":
        return path
    out = path.with_suffix(".wav")
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(path), "-ar", "16000", "-ac", "1",
         str(out)],
        capture_output=True,
    )
    if result.returncode != 0:
        stderr_tail = result.stderr.decode("utf-8", errors="replace")
        stderr_tail = stderr_tail[-_STDERR_TAIL_CHARS:]
        raise AudioConversionError(
            f"ffmpeg exited {result.returncode} converting {path.name}: "
            f"{stderr_tail}"
        )
    return out
