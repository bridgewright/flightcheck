"""Tests for scorer.audio_utils -- ffmpeg wav normalization (no real ffmpeg)."""
import subprocess
from pathlib import Path

import pytest

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
