"""Shared fixtures for the scorer test suite."""
from __future__ import annotations

import pytest

from scorer.config import load_product_config


@pytest.fixture
def permissive_eligibility(monkeypatch):
    """Zero out the F-04 eligibility floors for scoring-path tests.

    The real floors describe a 20-minute interview; the synthetic test
    recordings are ~8 seconds, which the real config correctly classifies as
    "insufficient". Tests that exercise the scored/judge paths lower the
    floors instead of shipping 600-second audio fixtures. Only the pipeline's
    view of the config is patched -- judges and DSP keep the real one.
    """
    cfg = load_product_config()
    permissive = cfg.model_copy(update={
        "eligibility": cfg.eligibility.model_copy(update={
            "min_duration_s": 0.0,
            "min_candidate_turns": 0,
            "min_candidate_words": 0,
            "full_duration_s": 0.0,
            "full_candidate_words": 0,
        })
    })
    monkeypatch.setattr(
        "scorer.api.pipeline.load_product_config", lambda: permissive
    )
