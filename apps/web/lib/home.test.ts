import { describe, expect, it } from "vitest";

import {
  formatSessionDate,
  greetingName,
  journeyLegs,
  nextSessionNumber,
  verdictLine,
} from "@/lib/home";
import type { JourneySession } from "@/lib/home";
import type { DimensionScore, SessionReport, Verdict } from "@/lib/types";

function sessions(...pairs: [number, JourneySession["status"]][]): JourneySession[] {
  return pairs.map(([index, status]) => ({ index, status }));
}

function dimensionScore(key: string, score: number): DimensionScore {
  return { dimension_key: key, score, evidence_quotes: [], rationale: "" };
}

function report(verdict: Verdict, dimensionScores: DimensionScore[]): SessionReport {
  return {
    session_id: "sess-1",
    verdict,
    overall_score: 3.4,
    dimension_scores: dimensionScores,
    delivery_metrics: {
      wpm_overall: 140,
      wpm_timeline: [],
      silence_events: [],
      filler_count: 0,
      filler_rate_per_min: 0,
      f0_variance: null,
      avg_response_latency_s: null,
    },
    delivery_observations: [],
    strengths: [],
    gaps: [],
    next_drills: [],
    limits_note: "",
  };
}

describe("journeyLegs", () => {
  it("points the first leg at a fresh package's first session", () => {
    expect(journeyLegs([], 6)).toEqual([
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("fills a dot for every attempted session and points at the one to create", () => {
    const legs = journeyLegs(
      sessions([1, "scored"], [2, "scoring"], [3, "scored"]),
      6,
    );
    expect(legs).toEqual(["done", "done", "done", "next", "todo", "todo"]);
  });

  it("treats a planned session as the next leg, not an attempted one", () => {
    expect(journeyLegs(sessions([1, "scored"], [2, "planned"]), 6)).toEqual([
      "done",
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("points at a failed session because its slot is resumed", () => {
    expect(journeyLegs(sessions([1, "scored"], [2, "failed"]), 6)).toEqual([
      "done",
      "next",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("still fills the dot of a failed session that is not the resume target", () => {
    // The planned slot at index 1 is resumed first, so the failed session at
    // index 2 reads as an attempt that happened.
    expect(journeyLegs(sessions([1, "planned"], [2, "failed"]), 4)).toEqual([
      "next",
      "done",
      "todo",
      "todo",
    ]);
  });

  it("leaves no next leg once the package is exhausted", () => {
    const legs = journeyLegs(
      sessions(
        [1, "scored"],
        [2, "scored"],
        [3, "scored"],
        [4, "scored"],
        [5, "scored"],
        [6, "scored"],
      ),
      6,
    );
    expect(legs).toEqual(["done", "done", "done", "done", "done", "done"]);
  });

  it("ignores sessions numbered beyond the package total", () => {
    expect(journeyLegs(sessions([1, "scored"], [9, "scored"]), 3)).toEqual([
      "done",
      "next",
      "todo",
    ]);
  });
});

describe("nextSessionNumber", () => {
  it("starts a fresh package at session 1", () => {
    expect(nextSessionNumber([], 6)).toBe(1);
  });

  it("creates the session after the highest existing index", () => {
    expect(nextSessionNumber(sessions([1, "scored"], [2, "scored"]), 6)).toBe(3);
  });

  it("resumes a planned session instead of creating a new one", () => {
    expect(nextSessionNumber(sessions([1, "scored"], [2, "planned"]), 6)).toBe(2);
  });

  it("resumes a failed session because its slot is preserved", () => {
    expect(nextSessionNumber(sessions([1, "failed"], [2, "scored"]), 6)).toBe(1);
  });

  it("resumes the lowest resumable slot when several are open", () => {
    expect(
      nextSessionNumber(sessions([1, "scored"], [2, "failed"], [3, "planned"]), 6),
    ).toBe(2);
  });

  it("reports an exhausted package as null", () => {
    expect(
      nextSessionNumber(
        sessions(
          [1, "scored"],
          [2, "scored"],
          [3, "scored"],
          [4, "scored"],
          [5, "scored"],
          [6, "scored"],
        ),
        6,
      ),
    ).toBeNull();
  });

  it("reports null when the next index would exceed the package total", () => {
    expect(nextSessionNumber(sessions([1, "scored"], [3, "scored"]), 3)).toBeNull();
  });
});

describe("verdictLine", () => {
  it("has nothing to say before the first report", () => {
    expect(verdictLine(null)).toBeNull();
  });

  it("names the weakest dimension and the session's focus", () => {
    const line = verdictLine(
      report("not_ready", [
        dimensionScore("ownership-impact", 3.3),
        dimensionScore("communication-delivery", 2.5),
      ]),
      { "communication-delivery": "Communication Delivery" },
    );
    expect(line?.text).toBe(
      "Last verdict: Not yet ready. Communication Delivery 2.5 — the lowest of your 2 dimensions. This session focuses there.",
    );
    expect(line?.headline).toBe("Not yet ready.");
  });

  it("humanizes a dimension key when no rubric name is available", () => {
    const line = verdictLine(
      report("approaching", [
        dimensionScore("communication-delivery", 2.5),
        dimensionScore("ownership-impact", 4.0),
      ]),
    );
    expect(line?.text).toBe(
      "Last verdict: Approaching. Communication delivery 2.5 — the lowest of your 2 dimensions. This session focuses there.",
    );
  });

  it("drops the comparison when the rubric has a single dimension", () => {
    const line = verdictLine(report("ready", [dimensionScore("communication", 4.6)]));
    expect(line?.text).toBe(
      "Last verdict: Ready. Communication 4.6. This session focuses there.",
    );
  });

  it("falls back to the verdict alone when no dimension was scored", () => {
    const line = verdictLine(report("not_ready", []));
    expect(line?.text).toBe("Last verdict: Not yet ready.");
    expect(line?.detail).toBe("");
  });
});

describe("greetingName", () => {
  it("greets an unknown viewer without a name", () => {
    expect(greetingName(null)).toBe("Welcome back.");
  });

  it("uses the local part before the first dot", () => {
    expect(greetingName("tae.hyun@example.com")).toBe("Welcome back, tae.");
  });

  it("stops at the first digit", () => {
    expect(greetingName("thk119914@gmail.com")).toBe("Welcome back, thk.");
  });

  it("lowercases the name", () => {
    expect(greetingName("TAE@example.com")).toBe("Welcome back, tae.");
  });

  it("drops the name when nothing usable is left", () => {
    expect(greetingName("119914@gmail.com")).toBe("Welcome back.");
    expect(greetingName("@example.com")).toBe("Welcome back.");
    expect(greetingName("")).toBe("Welcome back.");
  });
});

describe("formatSessionDate", () => {
  it("has nothing to show without a timestamp", () => {
    expect(formatSessionDate(null)).toBeNull();
  });

  it("formats a timestamp as a short absolute date", () => {
    expect(formatSessionDate("2026-07-30T21:41:00Z")).toBe("Jul 30");
  });

  it("ignores an unparseable timestamp", () => {
    expect(formatSessionDate("not a date")).toBeNull();
  });
});
