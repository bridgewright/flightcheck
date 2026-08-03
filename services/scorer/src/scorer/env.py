"""Environment loading for the CLI entrypoints.

`uv run` does not read `.env`, so every runner loads it explicitly and fails the
same way when a key it actually needs is missing: one message, at startup,
before a session is opened or a clip is read.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"   # services/scorer/.env


def load_env(path: Path | None = None) -> None:
    """Load `services/scorer/.env` if present.

    Locally .env is authoritative — override stale shell exports so the
    harness's explicit config wins, not inherited env vars. On Railway the
    platform's variables are authoritative instead: they are the deployment's
    real secrets, and a .env that rides along in the image must never shadow
    them (rotating a key in the dashboard has to actually take effect).
    """
    load_dotenv(path or ENV_PATH,
                override="RAILWAY_ENVIRONMENT" not in os.environ)


def require_key(name: str) -> str:
    """Return an API key or exit with an actionable message."""
    value = os.environ.get(name, "")
    if not value:
        raise SystemExit(f"{name} not set — create {ENV_PATH} with {name}=...")
    return value
