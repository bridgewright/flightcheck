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


def test_limits_guard_caps_and_windows():
    # v0.5 guards (F-29/F-30/F-31): every cap and window is product config,
    # never a code constant, so tuning a limit is a config change.
    limits = load_product_config().limits
    assert limits.max_packages_per_user == 10
    assert limits.package_create_window_s == 3600
    assert limits.package_create_per_window == 5
    assert limits.session_create_window_s == 3600
    assert limits.session_create_per_window == 20
    assert limits.complete_window_s == 3600
    assert limits.complete_per_window == 10
    assert limits.secret_mint_cap == 5
    assert limits.resume_attempt_cap == 3
    assert limits.score_attempt_cap == 3
    assert limits.compile_retry_cap == 3


def test_limits_input_and_lifecycle_bounds():
    limits = load_product_config().limits
    assert limits.jd_text_max_chars == 100_000
    assert limits.profile_text_max_chars == 50_000
    assert limits.pdf_b64_max_chars == 8_000_000
    assert limits.recording_max_minutes == 35
    assert limits.jd_compile_max_chars == 20_000
    assert limits.reaper_stale_after_s == 1800
    assert limits.reaper_interval_s == 300


def test_report_thresholds_and_forbidden_patterns():
    config = load_product_config()
    assert config.report.ready_overall == 4.0
    assert config.report.ready_min_dimension == 3.0
    assert config.report.approaching_overall == 3.0
    assert config.report.forbidden_patterns == [
        "nervous", "anxious", "scared", "you felt", "you were afraid",
        "you were feeling", "panicked", "insecure",
    ]
