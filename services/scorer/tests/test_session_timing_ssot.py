"""F-41: session timing must not drift between the worker and the room.

The numbers lived twice -- config/product.toml [session] here, and
SESSION_BUDGET_S / HARD_CUT_S in apps/web/lib/session-room.ts -- with
nothing comparing them. TypeScript won every disagreement in practice,
because the client owns the clock: the browser displays the budget, injects
the wrap-up notes at 75% and budget-minus-two, and auto-ends at the hard
cut. Editing product.toml alone would have changed nothing about a real
interview, silently.

This is the scorer-side half of the gate. The web-side half is
apps/web/tests/session-timing-ssot.test.ts; either suite alone catches a
one-sided edit, which matters because the two suites run separately.
"""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
PRODUCT_TOML = REPO_ROOT / "services" / "scorer" / "config" / "product.toml"
SESSION_ROOM_TS = REPO_ROOT / "apps" / "web" / "lib" / "session-room.ts"


def _ts_int_const(source: str, name: str) -> int:
    """The integer literal of `export const <name> = <int>;`."""
    match = re.search(
        rf"^export const {re.escape(name)} = (\d+);$", source, re.MULTILINE
    )
    if match is None:
        raise AssertionError(
            f"{name} is not an integer `export const` in session-room.ts -- "
            "the timing mirror moved and this gate no longer guards it"
        )
    return int(match.group(1))


@pytest.fixture(scope="module")
def session_config() -> dict:
    return tomllib.loads(PRODUCT_TOML.read_text())["session"]


@pytest.fixture(scope="module")
def room_source() -> str:
    return SESSION_ROOM_TS.read_text()


def test_the_room_mirrors_the_configured_budget(session_config, room_source):
    assert _ts_int_const(room_source, "SESSION_BUDGET_MINUTES") == (
        session_config["budget_minutes"]
    )


def test_the_room_mirrors_the_configured_hard_cut(session_config, room_source):
    assert _ts_int_const(room_source, "SESSION_HARD_CUT_MINUTES") == (
        session_config["hard_cut_minutes"]
    )


def test_the_room_mirrors_the_quick_timing_pair(session_config, room_source):
    assert _ts_int_const(room_source, "QUICK_SESSION_BUDGET_MINUTES") == (
        session_config["quick_budget_minutes"]
    )
    assert _ts_int_const(room_source, "QUICK_HARD_CUT_MINUTES") == (
        session_config["quick_hard_cut_minutes"]
    )


def test_the_room_mirrors_the_configured_heartbeat_interval(
    session_config, room_source
):
    assert _ts_int_const(room_source, "HEARTBEAT_INTERVAL_S") == (
        session_config["heartbeat_interval_s"]
    )


def test_the_room_derives_seconds_from_minutes(room_source):
    # The seconds constants must stay derived, not re-typed: a literal
    # `export const SESSION_BUDGET_S = 1200;` would pass the two checks
    # above while disagreeing with them.
    assert "export const SESSION_BUDGET_S = SESSION_BUDGET_MINUTES * 60;" in room_source
    assert "export const HARD_CUT_S = SESSION_HARD_CUT_MINUTES * 60;" in room_source
    assert (
        "export const QUICK_SESSION_BUDGET_S = QUICK_SESSION_BUDGET_MINUTES * 60;"
        in room_source
    )
    assert (
        "export const QUICK_HARD_CUT_S = QUICK_HARD_CUT_MINUTES * 60;"
        in room_source
    )


def test_the_hard_cut_leaves_room_after_the_budget(session_config):
    assert session_config["hard_cut_minutes"] > session_config["budget_minutes"]
    assert session_config["quick_hard_cut_minutes"] > session_config["quick_budget_minutes"]
