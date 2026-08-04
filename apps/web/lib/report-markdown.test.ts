import { describe, expect, it } from "vitest";

import { reportMarkdown } from "./report-markdown";
import type { SessionReport } from "./types";

const LIMITS = "This report reflects one 20-minute session and cannot predict every interview outcome.";

const report: SessionReport = {
  session_id: "session-3",
  verdict: "approaching",
  headline: "Strong examples need more concise delivery.",
  eligibility: "scored",
  overall_score: 3.7,
  dimension_scores: [
    {
      dimension_key: "story",
      score: 4.1,
      rationale: "The example had a clear result and retained the full context.",
      evidence_quotes: ['"I reduced the queue by half."'],
      strengths: [],
      weaknesses: [],
    },
    {
      dimension_key: "delivery",
      score: 3.3,
      rationale: "The answer was understandable but ran long.",
      evidence_quotes: [],
      strengths: [],
      weaknesses: [],
    },
  ],
  delivery_metrics: {
    wpm_overall: 142,
    wpm_timeline: [138, 146],
    silence_events: [{ start_s: 31, duration_s: 1.8 }],
    filler_count: 5,
    filler_rate_per_min: 1.2,
    f0_variance: 18.4,
    avg_response_latency_s: 1.1,
  },
  delivery_observations: [
    { at_s: 65, kind: "pace", note: "The conclusion accelerated.", conflicts_with_dsp: false },
  ],
  strengths: ["Specific outcomes"],
  gaps: ["Long setup"],
  next_drills: ["Give the result in the first sentence"],
  limits_note: LIMITS,
};

describe("reportMarkdown", () => {
  it("contains the limits note verbatim and every dimension name", () => {
    const markdown = reportMarkdown(report, {
      sessionNumber: 3,
      sessionDate: "2026-08-04",
      roleTitle: "Staff Engineer",
      generatedDate: "2026-08-04",
      dimensions: [
        { key: "story", name: "Story structure" },
        { key: "delivery", name: "Executive delivery" },
      ],
    });

    expect(markdown).toContain(LIMITS);
    expect(markdown).toContain("Story structure");
    expect(markdown).toContain("Executive delivery");
    expect(markdown).toContain('> "I reduced the queue by half."');
    expect(markdown).toContain("Ready bar: 4.0");
  });
});
