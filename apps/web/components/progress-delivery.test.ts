import { describe, expect, it } from "vitest";

import { DELIVERY_ROWS } from "@/components/progress-delivery";
import type { SessionProgressEntry } from "@/lib/worker";

// Builder for progress entries: scored by default, overridable per test.
// Mirrors progress-view.test.ts so the two suites speak the same fixtures.
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
    avg_response_latency_s: 1.4,
    silence: { count: 1, total_s: 2.0, longest_s: 2.0 },
    gaps: [],
    ...overrides,
  };
}

function row(label: string) {
  const found = DELIVERY_ROWS.find((candidate) => candidate.label === label);
  if (found === undefined) {
    throw new Error(`no delivery row labelled "${label}"`);
  }
  return found;
}

describe("DELIVERY_ROWS", () => {
  it("pins the rows and their order: primary measures, then silence detail", () => {
    expect(DELIVERY_ROWS.map((r) => [r.label, r.secondary])).toEqual([
      ["Words per minute", false],
      ["Fillers per minute", false],
      ["Avg response latency", false],
      ["Silences", true],
      ["Longest silence", true],
    ]);
  });

  it("formats pace as a whole number and fillers to one decimal", () => {
    const scored = entry({ wpm_overall: 141.6, filler_rate_per_min: 1.25 });
    expect(row("Words per minute").cell(scored)).toBe("142");
    expect(row("Fillers per minute").cell(scored)).toBe("1.3");
  });

  it("formats avg response latency in seconds to one decimal, like the report", () => {
    expect(row("Avg response latency").cell(entry({ avg_response_latency_s: 1.34 }))).toBe(
      "1.3s",
    );
  });

  it("renders a dash, never a zero, when latency is missing", () => {
    // null: the worker had no report, or the DSP could not measure a handoff.
    expect(row("Avg response latency").cell(entry({ avg_response_latency_s: null }))).toBe(
      null,
    );
    // Absent key: the entry was serialized by a worker older than the field.
    const legacy = entry({});
    delete (legacy as Partial<SessionProgressEntry>).avg_response_latency_s;
    expect(row("Avg response latency").cell(legacy)).toBe(null);
  });

  it("keeps a measured zero honest: 0.0s is a value, not missing data", () => {
    expect(row("Avg response latency").cell(entry({ avg_response_latency_s: 0 }))).toBe(
      "0.0s",
    );
  });

  it("dashes every unscored measure instead of inventing numbers", () => {
    const unscored = entry({
      status: "planned",
      wpm_overall: null,
      filler_rate_per_min: null,
      avg_response_latency_s: null,
      silence: null,
    });
    for (const deliveryRow of DELIVERY_ROWS) {
      expect(deliveryRow.cell(unscored)).toBe(null);
    }
  });

  it("reduces silence stats to a count and the longest event in whole seconds", () => {
    const scored = entry({ silence: { count: 3, total_s: 9.4, longest_s: 4.4 } });
    expect(row("Silences").cell(scored)).toBe("3");
    expect(row("Longest silence").cell(scored)).toBe("4s");
  });
});
