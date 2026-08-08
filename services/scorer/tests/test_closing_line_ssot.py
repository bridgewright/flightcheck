"""The web closing marker must remain inside the planner's closing line."""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PLANNER = REPO_ROOT / "services/scorer/src/scorer/sessionplan/planner.py"
SESSION_ROOM = REPO_ROOT / "apps/web/lib/session-room.ts"


def _required(source: str, pattern: str, name: str) -> str:
    match = re.search(pattern, source, re.MULTILINE | re.DOTALL)
    if match is None:
        raise AssertionError(
            f"{name} stopped matching its source -- the closing-line SSOT gate stopped guarding it"
        )
    return match.group(1)


def test_web_closing_marker_is_inside_planner_closing_line():
    planner = PLANNER.read_text(encoding="utf-8")
    room = SESSION_ROOM.read_text(encoding="utf-8")
    source = _required(planner, r"_CLOSING_LINE\s*=\s*\(\s*(.*?)\s*\)", "_CLOSING_LINE")
    closing = "".join(re.findall(r'"([^"]*)"', source)).lower()
    marker = _required(room, r'CLOSING_MARKER\s*=\s*"([^"]+)"', "CLOSING_MARKER")
    assert marker in closing
