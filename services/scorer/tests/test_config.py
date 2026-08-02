"""Tests for scorer.config -- the config/product.toml loader."""
from scorer.config import load_product_config


def test_models_section():
    config = load_product_config()
    assert config.models.interviewer == "gpt-realtime"
    assert config.models.scorer == "gemini-2.5-flash"
    assert config.models.triplet_generator == "gpt-5.1"


def test_session_limits():
    config = load_product_config()
    assert config.session.budget_minutes == 20
    assert config.session.hard_cut_minutes == 25
    assert config.session.silence_duration_ms == 900


def test_delivery_filler_lexicon_exact():
    assert load_product_config().delivery.fillers == [
        "uh", "um", "erm", "hmm", "you know", "i mean",
        "sort of", "kind of", "like",
    ]


def test_eligibility_thresholds():
    # F-04: scoring-eligibility floors are product config, never code.
    config = load_product_config()
    assert config.eligibility.min_duration_s == 600.0
    assert config.eligibility.min_candidate_turns == 5
    assert config.eligibility.min_candidate_words == 200
    assert config.eligibility.full_duration_s == 900.0
    assert config.eligibility.full_candidate_words == 600


def test_report_thresholds_and_forbidden_patterns():
    config = load_product_config()
    assert config.report.ready_overall == 4.0
    assert config.report.ready_min_dimension == 3.0
    assert config.report.approaching_overall == 3.0
    assert config.report.forbidden_patterns == [
        "nervous", "anxious", "scared", "you felt", "you were afraid",
        "you were feeling", "panicked", "insecure",
    ]
