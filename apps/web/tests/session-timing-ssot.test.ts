import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HARD_CUT_S,
  HEARTBEAT_INTERVAL_S,
  SESSION_BUDGET_MINUTES,
  SESSION_BUDGET_S,
  SESSION_HARD_CUT_MINUTES,
} from "@/lib/session-room";

// F-41: session timing is single-sourced in the worker's product.toml.
// Before this gate the numbers existed twice — [session] budget_minutes /
// hard_cut_minutes on the scorer side, SESSION_BUDGET_S / HARD_CUT_S here —
// and nothing compared them. TypeScript silently won every disagreement,
// because the client owns the clock: the room shows the budget, injects the
// wrap-up notes, and enforces the hard cut. A scorer-side change to the
// session length would have had no effect on any interview.
//
// This test is the mechanism, not a reminder: change one side and the web
// suite fails. The mirror gate on the scorer side lives in
// services/scorer/tests/test_session_timing_ssot.py, so either suite alone
// catches the drift.

const PRODUCT_TOML = fileURLToPath(
  new URL("../../../services/scorer/config/product.toml", import.meta.url),
);

/** Integer keys of one top-level TOML table. Deliberately tiny: the web has
 * no TOML parser and this test needs exactly two numbers. */
function tomlIntTable(source: string, table: string): Record<string, number> {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start === -1) throw new Error(`no [${table}] table in product.toml`);
  const values: Record<string, number> = {};
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) break;
    const match = /^([A-Za-z0-9_]+)\s*=\s*(\d+)\s*$/.exec(trimmed);
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
}

describe("session timing single source", () => {
  const session = tomlIntTable(readFileSync(PRODUCT_TOML, "utf-8"), "session");

  it("reads the two timings the room enforces out of product.toml", () => {
    expect(session.budget_minutes).toBeTypeOf("number");
    expect(session.hard_cut_minutes).toBeTypeOf("number");
  });

  it("matches the budget the room shows and paces against", () => {
    expect(SESSION_BUDGET_MINUTES).toBe(session.budget_minutes);
    expect(SESSION_BUDGET_S).toBe(session.budget_minutes * 60);
  });

  it("matches the hard cut the room auto-ends on", () => {
    expect(SESSION_HARD_CUT_MINUTES).toBe(session.hard_cut_minutes);
    expect(HARD_CUT_S).toBe(session.hard_cut_minutes * 60);
  });

  it("matches the heartbeat interval the room sends", () => {
    expect(session.heartbeat_interval_s).toBeTypeOf("number");
    expect(HEARTBEAT_INTERVAL_S).toBe(session.heartbeat_interval_s);
  });

  it("keeps the hard cut above the budget, whatever the config says", () => {
    expect(HARD_CUT_S).toBeGreaterThan(SESSION_BUDGET_S);
  });
});
