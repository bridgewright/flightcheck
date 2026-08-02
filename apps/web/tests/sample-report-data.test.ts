import { describe, expect, it } from "vitest";

// The sample-report page renders a checked-in JSON fixture through the same
// ReportView the product uses. The page used to cast that JSON blindly
// (`as unknown as`), so a stale or malformed fixture rendered garbage instead
// of failing. These tests pin the contract: the loader validates the fixture's
// shape and fills the F-03/F-04 fields (headline, eligibility, per-dimension
// strengths/weaknesses) that the worker serializes on real reports but a
// fixture written before those fields may lack.

import { loadSampleReport } from "@/app/sample-report/sample-data";
import sampleJson from "@/public/sample-report.json";

const RAW = sampleJson as unknown as Record<string, unknown>;

function clone(): Record<string, unknown> {
  return structuredClone(RAW);
}

type LooseReport = {
  report: Record<string, unknown> & {
    dimension_scores: Record<string, unknown>[];
  };
  dimensions: Record<string, unknown>[];
};

describe("loadSampleReport", () => {
  it("accepts the checked-in fixture and returns a complete report", () => {
    const { report, dimensions } = loadSampleReport(RAW);
    expect(typeof report.headline).toBe("string");
    expect(["scored", "limited"]).toContain(report.eligibility);
    expect(dimensions.length).toBeGreaterThan(0);
    for (const score of report.dimension_scores) {
      expect(Array.isArray(score.strengths)).toBe(true);
      expect(Array.isArray(score.weaknesses)).toBe(true);
    }
  });

  it("fills headline with the empty-string default when the fixture lacks it", () => {
    const raw = clone() as unknown as LooseReport;
    delete raw.report.headline;
    const { report } = loadSampleReport(raw);
    expect(report.headline).toBe("");
  });

  it("keeps an existing headline verbatim", () => {
    const raw = clone() as unknown as LooseReport;
    raw.report.headline = "Clear structure, delivery still rushed.";
    const { report } = loadSampleReport(raw);
    expect(report.headline).toBe("Clear structure, delivery still rushed.");
  });

  it("defaults eligibility to scored when the fixture lacks it", () => {
    const raw = clone() as unknown as LooseReport;
    delete raw.report.eligibility;
    const { report } = loadSampleReport(raw);
    expect(report.eligibility).toBe("scored");
  });

  it("keeps an existing limited eligibility", () => {
    const raw = clone() as unknown as LooseReport;
    raw.report.eligibility = "limited";
    const { report } = loadSampleReport(raw);
    expect(report.eligibility).toBe("limited");
  });

  it("fills per-dimension strengths and weaknesses with empty arrays", () => {
    const raw = clone() as unknown as LooseReport;
    for (const score of raw.report.dimension_scores) {
      delete score.strengths;
      delete score.weaknesses;
    }
    const { report } = loadSampleReport(raw);
    for (const score of report.dimension_scores) {
      expect(score.strengths).toEqual([]);
      expect(score.weaknesses).toEqual([]);
    }
  });

  it("preserves per-dimension strengths and weaknesses when present", () => {
    const raw = clone() as unknown as LooseReport;
    raw.report.dimension_scores[0].strengths = ["Concrete metrics in every answer."];
    raw.report.dimension_scores[0].weaknesses = ["No rollout risks named."];
    const { report } = loadSampleReport(raw);
    expect(report.dimension_scores[0].strengths).toEqual([
      "Concrete metrics in every answer.",
    ]);
    expect(report.dimension_scores[0].weaknesses).toEqual([
      "No rollout risks named.",
    ]);
  });

  it("rejects a verdict outside the product vocabulary", () => {
    const raw = clone() as unknown as LooseReport;
    raw.report.verdict = "crushing_it";
    expect(() => loadSampleReport(raw)).toThrow(/verdict/);
  });

  it("rejects a dimension score whose key has no dimension metadata", () => {
    const raw = clone() as unknown as LooseReport;
    raw.report.dimension_scores[0].dimension_key = "unknown-dimension";
    expect(() => loadSampleReport(raw)).toThrow(/unknown-dimension/);
  });

  it("rejects a fixture missing the report envelope entirely", () => {
    expect(() => loadSampleReport({ dimensions: [] })).toThrow(/report/);
  });
});
