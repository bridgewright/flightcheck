import type { DimensionMeta } from "@/components/ReportView";
import type { DimensionScore, SessionReport, Verdict } from "@/lib/types";

// Loader for the checked-in sample report fixture (public/sample-report.json).
//
// Real reports come from the worker, which serializes every field including
// the F-03/F-04 additions (headline, eligibility, per-dimension strengths and
// weaknesses). The fixture is static and predates those fields, so this loader
// fills the same defaults the worker would — and validates the shapes the page
// used to cast blindly, so a bad fixture edit fails tests instead of rendering
// garbage on the one report every visitor can see.

const VERDICTS: readonly Verdict[] = ["not_ready", "approaching", "ready"];

function fail(message: string): never {
  throw new Error(`sample-report.json: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${field} must be an array of strings`);
  }
  return value as string[];
}

export function loadSampleReport(raw: unknown): {
  report: SessionReport;
  dimensions: DimensionMeta[];
} {
  if (!isRecord(raw)) fail("fixture must be an object");
  if (!isRecord(raw.report)) fail("missing report envelope");
  if (!Array.isArray(raw.dimensions) || raw.dimensions.length === 0) {
    fail("missing dimensions metadata");
  }

  const dimensions = raw.dimensions as DimensionMeta[];
  const knownKeys = new Set(dimensions.map((dimension) => dimension.key));

  const base = raw.report;
  const verdict = base.verdict;
  if (typeof verdict !== "string" || !VERDICTS.includes(verdict as Verdict)) {
    fail(`verdict ${JSON.stringify(verdict)} is outside the product vocabulary`);
  }

  const eligibility = base.eligibility ?? "scored";
  if (eligibility !== "scored" && eligibility !== "limited") {
    fail(`eligibility ${JSON.stringify(eligibility)} is not scored|limited`);
  }

  const headline = base.headline ?? "";
  if (typeof headline !== "string") fail("headline must be a string");

  if (!Array.isArray(base.dimension_scores)) fail("missing dimension_scores");
  const dimensionScores: DimensionScore[] = base.dimension_scores.map(
    (entry: unknown) => {
      if (!isRecord(entry)) fail("dimension score must be an object");
      const key = entry.dimension_key;
      if (typeof key !== "string" || !knownKeys.has(key)) {
        fail(`dimension score references ${JSON.stringify(key)}, which has no metadata`);
      }
      return {
        ...(entry as unknown as DimensionScore),
        strengths: stringArray(entry.strengths, "strengths"),
        weaknesses: stringArray(entry.weaknesses, "weaknesses"),
      };
    },
  );

  const report: SessionReport = {
    ...(base as unknown as SessionReport),
    headline,
    eligibility,
    dimension_scores: dimensionScores,
  };

  return { report, dimensions };
}
