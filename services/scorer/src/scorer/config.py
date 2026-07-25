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
    silence_duration_ms: int


class DeliveryConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fillers: list[str]


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
    report: ReportConfig


def load_product_config() -> ProductConfig:
    """Load and validate config/product.toml."""
    return ProductConfig.model_validate(tomllib.loads(CONFIG_PATH.read_text()))
