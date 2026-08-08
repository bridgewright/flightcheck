"""The room's VAD tail and interviewer model must mirror product config."""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PRODUCT_TOML = REPO_ROOT / "services/scorer/config/product.toml"
REALTIME_TS = REPO_ROOT / "apps/web/lib/realtime.ts"
WEBROOM_SERVER = REPO_ROOT / "services/scorer/src/scorer/webroom/server.py"


def _required(source: str, pattern: str, name: str) -> str:
    match = re.search(pattern, source, re.MULTILINE)
    if match is None:
        raise AssertionError(
            f"{name} stopped matching its source -- the VAD SSOT gate stopped guarding it"
        )
    return match.group(1)


def test_vad_tail_and_interviewer_model_have_one_effective_value():
    product = tomllib.loads(PRODUCT_TOML.read_text(encoding="utf-8"))
    realtime = REALTIME_TS.read_text(encoding="utf-8")
    server = WEBROOM_SERVER.read_text(encoding="utf-8")

    configured_silence = product["session"]["silence_duration_ms"]
    realtime_silence = int(
        _required(realtime, r"silence_duration_ms:\s*(\d+)", "silence_duration_ms")
    )
    server_silence = int(_required(server, r"^SILENCE_MS\s*=\s*(\d+)$", "SILENCE_MS"))
    assert configured_silence == realtime_silence == server_silence

    realtime_prefix = int(_required(realtime, r"prefix_padding_ms:\s*(\d+)", "prefix_padding_ms"))
    server_prefix = int(_required(server, r"^PREFIX_PADDING_MS\s*=\s*(\d+)$", "PREFIX_PADDING_MS"))
    assert realtime_prefix == server_prefix

    realtime_model = _required(realtime, r'model:\s*"(gpt-realtime[^"\n]*)"', "interviewer model")
    assert product["models"]["interviewer"] == realtime_model
