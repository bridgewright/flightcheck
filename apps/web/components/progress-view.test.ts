import { describe, expect, it } from "vitest";

import {
  dimensionMeta,
  formatSigned,
  gapRecurrenceCount,
  humanizeDimensionKey,
  scoredInOrder,
  trailingBottomTwoStreak,
  trajectoryCells,
} from "@/components/progress-view";
import { recurringIssues } from "@/lib/progress";
import type { Rubric } from "@/lib/types";
import type { SessionProgressEntry } from "@/lib/worker";

// Builder for progress entries: scored by default, overridable per test.
// Mirrors lib/progress.test.ts so the two suites speak the same fixtures.
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

function rubric(): Rubric {
  return {
    role_title: "FDPM",
    company: null,
    dimensions: [
      {
        key: "structure",
        name: "Structured Communication",
        weight: 0.3,
        channel: "content",
        anchors: [],
        signals: [],
        citations: [],
      },
      {
        key: "composure",
        name: "Composure Under Pressure",
        weight: 0.2,
        channel: "delivery",
        anchors: [],
        signals: [],
        citations: [],
      },
    ],
    question_bank: [],
    research_summary: "",
  };
}

describe("dimensionMeta", () => {
  it("maps rubric dimensions to name and channel by key", () => {
    const meta = dimensionMeta(rubric());
    expect(meta.structure).toEqual({
      name: "Structured Communication",
      channel: "content",
    });
    expect(meta.composure).toEqual({
      name: "Composure Under Pressure",
      channel: "delivery",
    });
  });

  it("returns an empty map when the rubric is unavailable", () => {
    expect(dimensionMeta(null)).toEqual({});
  });
});

describe("humanizeDimensionKey", () => {
  it("turns a snake_case or kebab-case key into a capitalized phrase", () => {
    expect(humanizeDimensionKey("stakeholder_management")).toBe(
      "Stakeholder management",
    );
    expect(humanizeDimensionKey("problem-solving")).toBe("Problem solving");
  });
});

describe("formatSigned", () => {
  it("prefixes gains with a plus sign", () => {
    expect(formatSigned(0.5)).toBe("+0.5");
    expect(formatSigned(1)).toBe("+1.0");
  });

  it("keeps the minus sign on losses", () => {
    expect(formatSigned(-0.3)).toBe("-0.3");
  });

  it("never shows a signed zero", () => {
    expect(formatSigned(0)).toBe("0.0");
    expect(formatSigned(-0.04)).toBe("0.0");
    expect(formatSigned(0.04)).toBe("0.0");
  });
});

describe("scoredInOrder", () => {
  it("keeps only scored sessions, ascending by index", () => {
    const ordered = scoredInOrder([
      entry({ session_id: "s3", index: 3 }),
      entry({ session_id: "s2", index: 2, status: "failed", overall: null }),
      entry({ session_id: "s1", index: 1 }),
    ]);
    expect(ordered.map((e) => e.session_id)).toEqual(["s1", "s3"]);
  });
});

describe("trailingBottomTwoStreak", () => {
  const scores = (structure: number, composure: number, specificity: number) => [
    { dimension_key: "structure", score: structure },
    { dimension_key: "composure", score: composure },
    { dimension_key: "specificity", score: specificity },
  ];

  it("counts how many scored sessions from the end kept the key in the bottom two", () => {
    const entries = [
      entry({ session_id: "s1", index: 1, dimension_scores: scores(4.0, 2.0, 2.5) }),
      entry({ session_id: "s2", index: 2, dimension_scores: scores(4.0, 2.5, 3.0) }),
      entry({ session_id: "s3", index: 3, dimension_scores: scores(3.0, 2.0, 4.0) }),
    ];
    // composure is bottom-2 in every session; specificity fell out in s3
    // (streak resets to zero); structure only just entered (streak of one).
    expect(trailingBottomTwoStreak(entries, "composure")).toBe(3);
    expect(trailingBottomTwoStreak(entries, "specificity")).toBe(0);
    expect(trailingBottomTwoStreak(entries, "structure")).toBe(1);
  });

  it("ignores unscored sessions entirely", () => {
    const entries = [
      entry({ session_id: "s1", index: 1, dimension_scores: scores(4.0, 2.0, 2.5) }),
      entry({ session_id: "s2", index: 2, status: "failed", overall: null }),
      entry({ session_id: "s3", index: 3, dimension_scores: scores(4.0, 2.0, 2.5) }),
    ];
    expect(trailingBottomTwoStreak(entries, "composure")).toBe(2);
  });

  it("breaks ties by rubric position, matching lib/progress", () => {
    const tied = [
      { dimension_key: "a", score: 2.0 },
      { dimension_key: "b", score: 2.0 },
      { dimension_key: "c", score: 2.0 },
    ];
    const entries = [entry({ session_id: "s1", index: 1, dimension_scores: tied })];
    expect(trailingBottomTwoStreak(entries, "a")).toBe(1);
    expect(trailingBottomTwoStreak(entries, "b")).toBe(1);
    expect(trailingBottomTwoStreak(entries, "c")).toBe(0);
  });

  it("returns zero when nothing is scored", () => {
    expect(trailingBottomTwoStreak([], "structure")).toBe(0);
  });
});

describe("gapRecurrenceCount", () => {
  it("counts distinct sessions whose reports carry the gap, normalized", () => {
    const entries = [
      entry({
        session_id: "s1",
        index: 1,
        gaps: ["Long silences after challenges.", "long  SILENCES after challenges. "],
      }),
      entry({ session_id: "s2", index: 2, gaps: ["Long silences after challenges."] }),
      entry({ session_id: "s3", index: 3, gaps: ["Something else."] }),
    ];
    expect(gapRecurrenceCount(entries, "Long silences after challenges.")).toBe(2);
    expect(gapRecurrenceCount(entries, "Never reported.")).toBe(0);
  });
});

// progress-view restates rules that are private to lib/progress (bottom-two
// tie-break, gap normalization, scored ordering) because the focus copy must
// describe exactly what recurringIssues computed. These tests hold the two
// modules to EACH OTHER: if either side's rule drifts — a different
// tie-break, smarter gap matching, a changed status filter — an agreement
// here breaks before the copy can misdescribe a flagged issue.
describe("agreement with lib/progress recurringIssues", () => {
  it("keys flagged via a tie-broken bottom two carry a trailing streak; unflagged keys do not", () => {
    // All three dimensions tied: bottom-two membership is DECIDED by the
    // tie-break (rubric position), so any drift in either module's ranking
    // changes one side of these assertions.
    const tied = [
      { dimension_key: "a", score: 2.0 },
      { dimension_key: "b", score: 2.0 },
      { dimension_key: "c", score: 2.0 },
    ];
    const entries = [
      entry({ session_id: "s1", index: 1, dimension_scores: tied }),
      entry({ session_id: "s2", index: 2, dimension_scores: tied }),
    ];
    expect(recurringIssues(entries).weakDimensions).toEqual(["a", "b"]);
    for (const key of recurringIssues(entries).weakDimensions) {
      expect(trailingBottomTwoStreak(entries, key)).toBeGreaterThanOrEqual(2);
    }
    expect(trailingBottomTwoStreak(entries, "c")).toBe(0);
  });

  it("streaks survive an unscored row between scored sessions on both sides", () => {
    const low = [
      { dimension_key: "structure", score: 4.0 },
      { dimension_key: "composure", score: 2.0 },
      { dimension_key: "specificity", score: 2.5 },
    ];
    const entries = [
      entry({ session_id: "s1", index: 1, dimension_scores: low }),
      entry({ session_id: "s2", index: 2, status: "failed", overall: null }),
      entry({ session_id: "s3", index: 3, dimension_scores: low }),
    ];
    expect(recurringIssues(entries).weakDimensions).toContain("composure");
    expect(trailingBottomTwoStreak(entries, "composure")).toBe(2);
  });

  it("every flagged gap counts at least the two reports that flagged it", () => {
    // The same wording with different casing and spacing: flagging depends on
    // lib/progress's normalization, the count on progress-view's restatement.
    const entries = [
      entry({ session_id: "s1", index: 1, gaps: ["Long silences after challenges."] }),
      entry({ session_id: "s2", index: 2, gaps: [" long  SILENCES after challenges. "] }),
      entry({ session_id: "s3", index: 3, gaps: ["Something else."] }),
    ];
    const flagged = recurringIssues(entries).gaps;
    expect(flagged).toEqual(["Long silences after challenges."]);
    for (const gap of flagged) {
      expect(gapRecurrenceCount(entries, gap)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("trajectoryCells", () => {
  it("returns one cell per package slot, filling from the session rows", () => {
    const cells = trajectoryCells(
      [
        entry({ session_id: "s1", index: 1, overall: 2.4 }),
        entry({
          session_id: "s2",
          index: 2,
          status: "failed",
          verdict: null,
          overall: null,
        }),
      ],
      4,
    );
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({
      kind: "session",
      index: 1,
      status: "scored",
      verdict: "not_ready",
      overall: 2.4,
    });
    expect(cells[1]).toEqual({
      kind: "session",
      index: 2,
      status: "failed",
      verdict: null,
      overall: null,
    });
    expect(cells[2]).toEqual({ kind: "empty", index: 3 });
    expect(cells[3]).toEqual({ kind: "empty", index: 4 });
  });

  it("ignores rows numbered outside the package's own range", () => {
    const cells = trajectoryCells([entry({ session_id: "s9", index: 9 })], 2);
    expect(cells).toEqual([
      { kind: "empty", index: 1 },
      { kind: "empty", index: 2 },
    ]);
  });

  it("returns no cells for a zero-session package", () => {
    expect(trajectoryCells([], 0)).toEqual([]);
  });
});
