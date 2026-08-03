import { describe, expect, it } from "vitest";

import {
  archiveStatusPill,
  formatDelta,
  overallDeltas,
  topObservations,
  verdictPillClasses,
} from "./report-format";
import type { SessionStatus, TimestampedObservation } from "./types";

const obs = (
  at_s: number,
  conflicts_with_dsp = false,
): TimestampedObservation => ({
  at_s,
  kind: "pace",
  note: `note at ${at_s}`,
  conflicts_with_dsp,
});

describe("topObservations", () => {
  it("returns everything when the list fits the cap", () => {
    const all = [obs(10), obs(20)];
    expect(topObservations(all, 5)).toEqual(all);
  });

  it("caps at max, keeping the earliest of the rest", () => {
    const all = [obs(10), obs(20), obs(30), obs(40), obs(50), obs(60)];
    expect(topObservations(all, 5).map((o) => o.at_s)).toEqual([
      10, 20, 30, 40, 50,
    ]);
  });

  it("always includes DSP conflicts, even late ones, in timeline order", () => {
    const all = [obs(10), obs(20), obs(30), obs(40), obs(50), obs(60, true)];
    expect(topObservations(all, 5).map((o) => o.at_s)).toEqual([
      10, 20, 30, 40, 60,
    ]);
  });

  it("handles an empty list", () => {
    expect(topObservations([], 5)).toEqual([]);
  });
});

describe("formatDelta", () => {
  it("signs improvements and regressions, one decimal", () => {
    expect(formatDelta(0.4)).toBe("+0.4");
    expect(formatDelta(-0.35)).toBe("-0.3");
  });

  it("renders a flat delta without a sign", () => {
    expect(formatDelta(0)).toBe("0.0");
  });

  it("does not sign a delta that rounds to zero", () => {
    expect(formatDelta(0.04)).toBe("0.0");
    expect(formatDelta(-0.04)).toBe("0.0");
  });
});

const row = (
  id: string,
  index: number,
  status: SessionStatus,
  overall: number | null,
) => ({ id, index, status, overall });

describe("overallDeltas", () => {
  it("gives the first scored session no delta", () => {
    expect(overallDeltas([row("a", 1, "scored", 3.0)]).has("a")).toBe(false);
  });

  it("computes each scored session's delta vs the previous scored one", () => {
    const deltas = overallDeltas([
      row("a", 1, "scored", 2.8),
      row("b", 2, "scored", 3.2),
      row("c", 3, "scored", 3.0),
    ]);
    expect(deltas.get("b")).toBeCloseTo(0.4);
    expect(deltas.get("c")).toBeCloseTo(-0.2);
  });

  it("skips unscored rows without breaking the chain", () => {
    const deltas = overallDeltas([
      row("a", 1, "scored", 2.8),
      row("b", 2, "failed", null),
      row("c", 3, "insufficient", null),
      row("d", 4, "scored", 3.4),
    ]);
    expect(deltas.get("d")).toBeCloseTo(0.6);
    expect(deltas.has("b")).toBe(false);
    expect(deltas.has("c")).toBe(false);
  });

  it("orders by session index, not input order", () => {
    const deltas = overallDeltas([
      row("late", 3, "scored", 3.5),
      row("early", 1, "scored", 3.0),
    ]);
    expect(deltas.get("late")).toBeCloseTo(0.5);
    expect(deltas.has("early")).toBe(false);
  });

  it("ignores a scored row with no overall (defensive)", () => {
    const deltas = overallDeltas([
      row("a", 1, "scored", 3.0),
      row("b", 2, "scored", null),
      row("c", 3, "scored", 3.2),
    ]);
    expect(deltas.get("c")).toBeCloseTo(0.2);
    expect(deltas.has("b")).toBe(false);
  });
});

describe("verdictPillClasses", () => {
  it("color-codes verdict pills like the verdict box", () => {
    expect(verdictPillClasses("not_ready")).toContain("red");
    expect(verdictPillClasses("approaching")).toContain("amber");
    expect(verdictPillClasses("ready")).toContain("green");
  });

  it("gives each verdict a distinct pill style", () => {
    const styles = new Set([
      verdictPillClasses("not_ready"),
      verdictPillClasses("approaching"),
      verdictPillClasses("ready"),
    ]);
    expect(styles.size).toBe(3);
  });
});

describe("archiveStatusPill", () => {
  it("returns null for scored rows — the verdict pill speaks instead", () => {
    expect(archiveStatusPill("scored")).toBeNull();
  });

  it("labels a planned row as a preserved slot", () => {
    const pill = archiveStatusPill("planned");
    expect(pill?.label).toBe("Not started, slot preserved");
  });

  it("labels scoring, failed, and insufficient rows honestly", () => {
    expect(archiveStatusPill("scoring")?.label).toBe("Scoring…");
    expect(archiveStatusPill("failed")?.label).toBe("Scoring failed");
    expect(archiveStatusPill("insufficient")?.label).toBe(
      "Not scored: not enough evidence",
    );
  });

  it("gives every unscored status a styled pill", () => {
    const statuses: SessionStatus[] = [
      "planned",
      "scoring",
      "failed",
      "insufficient",
    ];
    for (const status of statuses) {
      const pill = archiveStatusPill(status);
      expect(pill?.className).toBeTruthy();
    }
  });
});
