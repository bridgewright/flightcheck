"""Tests for scorer.audio_utils -- ffmpeg wav normalization (no real ffmpeg)."""
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from scorer import audio_utils


def test_ensure_wav_returns_wav_path_unchanged(tmp_path, monkeypatch):
    def _forbid_run(*args, **kwargs):
        raise AssertionError("subprocess.run must not run for a .wav input")

    monkeypatch.setattr(audio_utils.subprocess, "run", _forbid_run)
    wav = tmp_path / "session.wav"
    wav.write_bytes(b"RIFF")

    assert audio_utils.ensure_wav(wav) is wav


def test_ensure_wav_converts_via_ffmpeg_to_sibling_wav(tmp_path, monkeypatch):
    recorded: list[list[str]] = []

    def _fake_run(argv, capture_output=False, **kwargs):
        recorded.append(list(argv))
        assert capture_output is True
        Path(argv[-1]).write_bytes(b"RIFF")
        return subprocess.CompletedProcess(argv, 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(audio_utils.subprocess, "run", _fake_run)
    webm = tmp_path / "session.webm"
    webm.write_bytes(b"\x1aE\xdf\xa3")

    out = audio_utils.ensure_wav(webm)

    assert out == tmp_path / "session.wav"
    assert out.exists()
    assert recorded == [[
        "ffmpeg", "-y", "-i", str(webm), "-ar", "16000", "-ac", "1", str(out),
    ]]


def test_ensure_wav_failure_raises_with_stderr_tail_only(tmp_path, monkeypatch):
    stderr_text = ("configuration line\n" * 100
                   + "Invalid data found when processing input")

    def _fake_run(argv, capture_output=False, **kwargs):
        return subprocess.CompletedProcess(
            argv, 1, stdout=b"", stderr=stderr_text.encode())

    monkeypatch.setattr(audio_utils.subprocess, "run", _fake_run)
    webm = tmp_path / "broken.webm"
    webm.write_bytes(b"junk")

    with pytest.raises(audio_utils.AudioConversionError) as excinfo:
        audio_utils.ensure_wav(webm)

    message = str(excinfo.value)
    assert "Invalid data found when processing input" in message
    assert stderr_text not in message  # tail only, never the full dump
    assert len(message) < 700


def _ffmpeg_works() -> bool:
    """True when ffmpeg exists AND actually runs.

    `which` alone lies: a stale Homebrew install can sit on PATH yet die at
    load time on a missing dylib, which is indistinguishable from absent
    for this test's purpose.
    """
    if shutil.which("ffmpeg") is None:
        return False
    try:
        probe = subprocess.run(["ffmpeg", "-version"], capture_output=True)
    except OSError:
        return False
    return probe.returncode == 0


@pytest.mark.skipif(
    not _ffmpeg_works(),
    reason="no runnable ffmpeg on this machine (binary missing or its "
           "dynamic libraries are broken); the real mp4 transcode path "
           "cannot be exercised here — production installs its own ffmpeg "
           "via nixpacks",
)
def test_ensure_wav_transcodes_a_real_mp4_recording(tmp_path):
    """Safari's MediaRecorder fallback records audio/mp4 (Track B); the
    scoring pipeline must turn that container into the 16 kHz mono wav the
    DSP and Gemini paths require. Real ffmpeg, fixture generated on the fly
    (house rule: no committed audio binaries)."""
    rate = 16000
    duration_s = 2.0
    t = np.linspace(0.0, duration_s, int(rate * duration_s), endpoint=False)
    source_wav = tmp_path / "source.wav"
    sf.write(source_wav, 0.3 * np.sin(2 * np.pi * 220.0 * t), rate,
             format="WAV", subtype="PCM_16")
    mp4 = tmp_path / "session-1.mp4"
    encode = subprocess.run(
        ["ffmpeg", "-y", "-i", str(source_wav), "-c:a", "aac", str(mp4)],
        capture_output=True,
    )
    assert encode.returncode == 0, encode.stderr.decode()[-500:]
    assert mp4.stat().st_size > 0

    out = audio_utils.ensure_wav(mp4)

    assert out == tmp_path / "session-1.wav"
    info = sf.info(str(out))
    assert info.samplerate == 16000
    assert info.channels == 1
    # AAC encode/decode pads edges slightly; the content must survive.
    assert info.duration == pytest.approx(duration_s, abs=0.25)
