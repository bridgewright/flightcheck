import { describe, expect, it } from "vitest";

import type { SessionProgressEntry } from "@/lib/worker";
import { deltaVsPrevious, dimensionTrends, recurringIssues } from "@/lib/progress";

// Builder for progress entries: scored by default, overridable per test.
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
    filler_rate_per_min: 2.0,
    silence: { count: 1, total_s: 2.0, longest_s: 2.0 },
    gaps: [],
    ...overrides,
  };
}

describe("dimensionTrends", () => {
  it("builds one series per dimension across scored sessions, in session order", () => {
    const trends = dimensionTrends([
      entry({
        session_id: "s2",
        index: 2,
        dimension_scores: [
          { dimension_key: "structure", score: 3.5 },
          { dimension_key: "composure", score: 2.5 },
        ],
      }),
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [
          { dimension_key: "structure", score: 2.5 },
          { dimension_key: "composure", score: 2.0 },
        ],
      }),
    ]);
    expect(trends).toHaveLength(2);
    expect(trends[0].dimension_key).toBe("structure");
    expect(trends[0].points).toEqual([
      { session_id: "s1", index: 1, score: 2.5 },
      { session_id: "s2", index: 2, score: 3.5 },
    ]);
    expect(trends[0].net).toBeCloseTo(1.0);
    expect(trends[1].dimension_key).toBe("composure");
    expect(trends[1].net).toBeCloseTo(0.5);
  });

  it("keeps the rubric's dimension order from the first scored session", () => {
    const trends = dimensionTrends([
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [
          { dimension_key: "composure", score: 2.0 },
          { dimension_key: "structure", score: 2.5 },
        ],
      }),
    ]);
    expect(trends.map((t) => t.dimension_key)).toEqual(["composure", "structure"]);
  });

  it("ignores sessions that are not scored", () => {
    const trends = dimensionTrends([
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [{ dimension_key: "structure", score: 2.5 }],
      }),
      entry({
        session_id: "s2",
        index: 2,
        status: "failed",
        verdict: null,
        overall: null,
        dimension_scores: [],
      }),
      entry({
        session_id: "s3",
        index: 3,
        status: "insufficient",
        verdict: null,
        overall: null,
        dimension_scores: [],
      }),
    ]);
    expect(trends).toHaveLength(1);
    expect(trends[0].points).toHaveLength(1);
    expect(trends[0].net).toBe(0);
  });

  it("returns an empty list when nothing is scored", () => {
    expect(dimensionTrends([entry({ status: "planned", overall: null })])).toEqual([]);
    expect(dimensionTrends([])).toEqual([]);
  });
});

describe("deltaVsPrevious", () => {
  it("returns null with fewer than two scored sessions", () => {
    expect(deltaVsPrevious([])).toBeNull();
    expect(
      deltaVsPrevious([
        entry({ session_id: "s1", index: 1 }),
        entry({ session_id: "s2", index: 2, status: "failed", overall: null }),
      ]),
    ).toBeNull();
  });

  it("compares the latest scored session against the previous scored one", () => {
    const delta = deltaVsPrevious([
      entry({
        session_id: "s1",
        index: 1,
        overall: 2.4,
        dimension_scores: [
          { dimension_key: "structure", score: 2.5 },
          { dimension_key: "composure", score: 2.0 },
        ],
      }),
      // A failed attempt between the two scored ones must not break the pair.
      entry({ session_id: "s2", index: 2, status: "failed", overall: null }),
      entry({
        session_id: "s3",
        index: 3,
        overall: 3.1,
        dimension_scores: [
          { dimension_key: "structure", score: 3.5 },
          { dimension_key: "composure", score: 2.5 },
        ],
      }),
    ]);
    expect(delta).not.toBeNull();
    expect(delta?.latest_session_id).toBe("s3");
    expect(delta?.previous_session_id).toBe("s1");
    expect(delta?.overall).toBeCloseTo(0.7);
    expect(delta?.dimensions.structure).toBeCloseTo(1.0);
    expect(delta?.dimensions.composure).toBeCloseTo(0.5);
  });

  it("only reports dimensions present in both sessions", () => {
    const delta = deltaVsPrevious([
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [{ dimension_key: "structure", score: 2.5 }],
      }),
      entry({
        session_id: "s2",
        index: 2,
        dimension_scores: [
          { dimension_key: "structure", score: 3.0 },
          { dimension_key: "composure", score: 2.0 },
        ],
      }),
    ]);
    expect(delta?.dimensions).toEqual({ structure: 0.5 });
  });
});

describe("recurringIssues", () => {
  it("reports a gap that recurs across two or more sessions", () => {
    const issues = recurringIssues([
      entry({
        session_id: "s1",
        index: 1,
        gaps: ["Long silences after challenges.", "Answers bury the recommendation."],
      }),
      entry({
        session_id: "s2",
        index: 2,
        gaps: ["Long   silences after challenges. "],
      }),
    ]);
    // Normalized string equality: case/whitespace differences still match;
    // the first-seen original text is what gets reported.
    expect(issues.gaps).toEqual(["Long silences after challenges."]);
  });

  it("counts a gap once per session, not once per occurrence", () => {
    const issues = recurringIssues([
      entry({ session_id: "s1", index: 1, gaps: ["Same gap.", "same gap."] }),
    ]);
    expect(issues.gaps).toEqual([]);
  });

  it("does not fuzzy-match different wordings", () => {
    const issues = recurringIssues([
      entry({ session_id: "s1", index: 1, gaps: ["Long silences after challenges."] }),
      entry({ session_id: "s2", index: 2, gaps: ["Silences run long after challenges."] }),
    ]);
    expect(issues.gaps).toEqual([]);
  });

  it("flags a dimension in the bottom two of two consecutive scored sessions", () => {
    const issues = recurringIssues([
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [
          { dimension_key: "structure", score: 4.0 },
          { dimension_key: "composure", score: 2.0 },
          { dimension_key: "specificity", score: 2.5 },
          { dimension_key: "ownership", score: 3.5 },
        ],
      }),
      entry({
        session_id: "s2",
        index: 2,
        dimension_scores: [
          { dimension_key: "structure", score: 4.0 },
          { dimension_key: "composure", score: 2.5 },
          { dimension_key: "specificity", score: 3.5 },
          { dimension_key: "ownership", score: 3.0 },
        ],
      }),
    ]);
    // composure is bottom-2 in both consecutive sessions; specificity and
    // ownership each appear once only.
    expect(issues.weakDimensions).toEqual(["composure"]);
  });

  it("requires the bottom-2 appearances to be consecutive", () => {
    const issues = recurringIssues([
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [
          { dimension_key: "structure", score: 2.0 },
          { dimension_key: "composure", score: 2.5 },
          { dimension_key: "specificity", score: 4.0 },
          { dimension_key: "ownership", score: 4.5 },
        ],
      }),
      entry({
        session_id: "s2",
        index: 2,
        dimension_scores: [
          { dimension_key: "structure", score: 4.0 },
          { dimension_key: "composure", score: 4.5 },
          { dimension_key: "specificity", score: 2.0 },
          { dimension_key: "ownership", score: 2.5 },
        ],
      }),
      entry({
        session_id: "s3",
        index: 3,
        dimension_scores: [
          { dimension_key: "structure", score: 2.0 },
          { dimension_key: "composure", score: 2.5 },
          { dimension_key: "specificity", score: 4.0 },
          { dimension_key: "ownership", score: 4.5 },
        ],
      }),
    ]);
    // structure/composure are bottom-2 in s1 and s3 but not s2 — an improved
    // middle session breaks the streak by design.
    expect(issues.weakDimensions).toEqual([]);
  });

  it("skips unscored sessions without breaking consecutiveness of scored ones", () => {
    const issues = recurringIssues([
      entry({
        session_id: "s1",
        index: 1,
        dimension_scores: [
          { dimension_key: "structure", score: 2.0 },
          { dimension_key: "composure", score: 2.5 },
          { dimension_key: "specificity", score: 4.0 },
        ],
      }),
      entry({ session_id: "s2", index: 2, status: "failed", overall: null }),
      entry({
        session_id: "s3",
        index: 3,
        dimension_scores: [
          { dimension_key: "structure", score: 2.0 },
          { dimension_key: "composure", score: 2.5 },
          { dimension_key: "specificity", score: 4.0 },
        ],
      }),
    ]);
    // "Consecutive" means consecutive SCORED sessions: s1 and s3 are adjacent
    // in the scored sequence because s2 produced no scores at all.
    expect(issues.weakDimensions).toEqual(["structure", "composure"]);
  });

  it("breaks bottom-2 ties deterministically by rubric position", () => {
    const scores = [
      { dimension_key: "a", score: 2.0 },
      { dimension_key: "b", score: 2.0 },
      { dimension_key: "c", score: 2.0 },
    ];
    const issues = recurringIssues([
      entry({ session_id: "s1", index: 1, dimension_scores: scores }),
      entry({ session_id: "s2", index: 2, dimension_scores: scores }),
    ]);
    // All tied: the first two by rubric position win the bottom-2 slots.
    expect(issues.weakDimensions).toEqual(["a", "b"]);
  });

  it("returns empty results for zero or one session", () => {
    expect(recurringIssues([])).toEqual({ gaps: [], weakDimensions: [] });
    expect(
      recurringIssues([
        entry({
          session_id: "s1",
          index: 1,
          gaps: ["Only one session."],
          dimension_scores: [
            { dimension_key: "structure", score: 2.0 },
            { dimension_key: "composure", score: 2.5 },
          ],
        }),
      ]),
    ).toEqual({ gaps: [], weakDimensions: [] });
  });
});
