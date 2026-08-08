"""Opt-in regression for transcription segmentation on a synthetic clip."""
from __future__ import annotations

import json
import os
from itertools import pairwise
from pathlib import Path

import pytest

from scorer.content.transcribe import transcribe_verbatim
from scorer.genai_compat import make_client

REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN_DIR = REPO_ROOT / "evals/suites/morgan_naturalness/golden"
GOLDEN_WAV = GOLDEN_DIR / "golden.wav"
EXPECTED_JSON = GOLDEN_DIR / "expected.json"


def test_golden_clip_segmentation_matches_committed_expectations():
    if os.environ.get("RUN_SEGMENTATION_REGRESSION") != "1":
        pytest.skip("RUN_SEGMENTATION_REGRESSION=1 is not set")
    if not os.environ.get("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY is not set")
    if not GOLDEN_WAV.is_file():
        pytest.skip("golden/golden.wav is absent; run make_golden.sh locally")

    expected = json.loads(EXPECTED_JSON.read_text(encoding="utf-8"))
    if expected["status"] != "measured":
        # Estimates that were never confirmed against a transcription run
        # would fail as "the ruler moved" when nothing had moved. A drift
        # gate that can cry drift on its own guesses is worse than absent.
        pytest.skip("expected.json is still status=unmeasured; run the measurement pass first")

    segments = transcribe_verbatim(
        GOLDEN_WAV, make_client(os.environ["GEMINI_API_KEY"])
    )
    count = expected["segment_count"]
    assert len(segments) == pytest.approx(count["expected"], abs=count["tolerance"])

    total_speech_s = sum(segment.end_s - segment.start_s for segment in segments)
    speech = expected["total_speech_s"]
    assert total_speech_s == pytest.approx(
        speech["expected"], rel=speech["tolerance_fraction"]
    )

    boundaries = [
        (prior.end_s, following.start_s)
        for prior, following in pairwise(segments)
        if following.start_s > prior.end_s
    ]
    for pause in expected["pause_boundaries"]:
        assert any(
            start == pytest.approx(pause["start_s"], abs=pause["tolerance_s"])
            and end == pytest.approx(pause["end_s"], abs=pause["tolerance_s"])
            for start, end in boundaries
        ), f"no measured pause matched {pause}"
