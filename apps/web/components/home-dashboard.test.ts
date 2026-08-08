import { describe, expect, it } from "vitest";

import {
  overallNet,
  overallTrend,
  trendSectionVisible,
} from "@/components/home-dashboard";
import type { SessionProgressEntry } from "@/lib/worker";

function entry(overrides: Partial<SessionProgressEntry>): SessionProgressEntry {
  return {
    session_id: "sess-x",
    index: 1,
    created_at: "2026-08-01T09:00:00Z",
    status: "scored",
    verdict: "not_ready",
    overall: 2.5,
    dimension_scores: [],
    wpm_overall: 120,
    filler_rate_per_min: 2,
    silence: null,
    gaps: [],
    ...overrides,
  };
}

describe("overallTrend", () => {
  it("returns no points for an empty feed", () => {
    expect(overallTrend([])).toEqual([]);
  });

  it("keeps one scored session with an overall", () => {
    expect(overallTrend([entry({ index: 2, overall: 3.4 })])).toEqual([
      { index: 2, score: 3.4 },
    ]);
  });

  it("excludes unscored statuses and null overalls", () => {
    expect(
      overallTrend([
        entry({ index: 1, status: "failed", overall: 4.8 }),
        entry({ index: 2, overall: null }),
        entry({ index: 3, overall: 3.8 }),
      ]),
    ).toEqual([{ index: 3, score: 3.8 }]);
  });

  it("orders points by ascending session index", () => {
    expect(
      overallTrend([
        entry({ index: 4, overall: 4.2 }),
        entry({ index: 1, overall: 2.7 }),
      ]),
    ).toEqual([
      { index: 1, score: 2.7 },
      { index: 4, score: 4.2 },
    ]);
  });
});

describe("overallNet", () => {
  it("returns zero with fewer than two points", () => {
    expect(overallNet([])).toBe(0);
    expect(overallNet([{ index: 1, score: 3 }])).toBe(0);
  });

  it("preserves the sign of movement from first to last", () => {
    expect(overallNet([{ index: 1, score: 2.5 }, { index: 2, score: 3.1 }])).toBeCloseTo(0.6);
    expect(overallNet([{ index: 1, score: 4.1 }, { index: 2, score: 3.6 }])).toBeCloseTo(-0.5);
  });
});

describe("trendSectionVisible", () => {
  it("requires at least two scored sessions with overall scores", () => {
    expect(trendSectionVisible([entry({ index: 1 })])).toBe(false);
    expect(trendSectionVisible([entry({ index: 1 }), entry({ index: 2 })])).toBe(true);
  });
});
