"""Product configuration: model ids, session limits, lexicons, thresholds.

House pattern (see realtime_probe/openai_probe.py): TOML under
services/scorer/config/, tomllib, one loader per file returning a small
pydantic model. extra="forbid" makes a typo in the TOML a loud failure at
load time instead of a silently ignored key.
"""
from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "product.toml"


class ModelsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    interviewer: str                  # OpenAI Realtime interviewer
    scorer: str                       # Gemini scoring/structuring/transcription
    triplet_generator: str            # eval-only; vendor != judge vendor


class SessionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    budget_minutes: int
    hard_cut_minutes: int
    heartbeat_interval_s: int
    heartbeat_stale_after_s: int
    silence_duration_ms: int
    quick_budget_minutes: int
    quick_hard_cut_minutes: int


class DeliveryConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fillers: list[str]


class EligibilityConfig(BaseModel):
    """F-04 scoring-eligibility floors (scorer/report/eligibility.py).

    min_* are hard floors: below any of them a session is "insufficient" --
    no judge calls, no report. full_* are full-evidence bars: at or above
    every floor but below any bar, the session scores as "limited".
    """

    model_config = ConfigDict(extra="forbid")

    min_duration_s: float
    min_candidate_turns: int
    min_candidate_words: int
    full_duration_s: float
    full_candidate_words: int


class LimitsConfig(BaseModel):
    """v0.5 guard caps and lifecycle windows (F-29/F-30/F-31, F-11a).

    Every abuse cap, rate-limit window, input bound, and reaper threshold
    lives here so tuning a guard is a config change, never a code change.
    Fixed-window rate limits pair a *_window_s duration with a *_per_window
    hit budget, keyed per account.
    """

    model_config = ConfigDict(extra="forbid")

    max_packages_per_user: int        # absolute per-account package ceiling
    package_create_window_s: float
    package_create_per_window: int
    session_create_window_s: float
    session_create_per_window: int
    complete_window_s: float
    complete_per_window: int
    secret_mint_cap: int              # realtime-secret mints per session
    resume_attempt_cap: int           # failed/insufficient resumes per session
    score_attempt_cap: int            # scoring runs per session
    compile_retry_cap: int            # compile retries per package
    jd_text_max_chars: int
    profile_text_max_chars: int       # resume_text / linkedin_text each
    pdf_b64_max_chars: int            # checked BEFORE base64 decode
    recording_max_minutes: float      # scoring-intake duration ceiling
    jd_compile_max_chars: int         # JD truncation before the rubric compiler
    reaper_stale_after_s: float       # stuck compiling/scoring older than this
    reaper_interval_s: float          # periodic reaper cadence
    feedback_window_s: float
    feedback_per_window: int
    cbt_redeem_window_s: float
    cbt_redeem_per_window: int
    feedback_text_max_chars: int
    max_feedback_per_user: int
    study_window_s: float
    study_per_window: int
    study_generating_stale_after_s: float
    paraphrase_max_items: int
    quick_package_cap: int
    quick_company_max_chars: int
    quick_role_max_chars: int


class ReportConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready_overall: float
    ready_min_dimension: float
    approaching_overall: float
    forbidden_patterns: list[str]


class ProductConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    models: ModelsConfig
    session: SessionConfig
    delivery: DeliveryConfig
    eligibility: EligibilityConfig
    report: ReportConfig
    limits: LimitsConfig


def load_product_config() -> ProductConfig:
    """Load and validate config/product.toml."""
    return ProductConfig.model_validate(tomllib.loads(CONFIG_PATH.read_text()))
