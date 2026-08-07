import { createScorer } from "evalite";

import { barAxes } from "./bar";
import type { MorganMetricsCase } from "./load-metrics";

// Three distinct outcomes, and the distinction is the point (review seam,
// 2026-08-07): a number is a measurement; an explicit null is an honest
// "could not measure" (f0 on unvoiced audio); an ABSENT field is schema
// drift between the Python writer and this reader and must read as an
// error, never as a quiet zero.
function resolveMetric(
  metrics: MorganMetricsCase["metrics"],
  metricPath: string,
): number | null | undefined {
  const [field, nestedField, ...remainder] = metricPath.split(".");
  if (remainder.length > 0) return undefined;

  const value = metrics[field];
  if (nestedField === undefined) {
    return typeof value === "number" || value === null ? value : undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  if (!(nestedField in value)) return undefined;
  const nestedValue = value[nestedField];
  return typeof nestedValue === "number" || nestedValue === null
    ? nestedValue
    : undefined;
}

export const naturalnessScorers = Object.entries(barAxes).map(
  ([axisName, axis]) =>
    createScorer<MorganMetricsCase, MorganMetricsCase, undefined>({
      name: axisName,
      description: `Checks ${axis.metric} against its inclusive naturalness band`,
      scorer: ({ output }) => {
        const actual = resolveMetric(output.metrics, axis.metric);
        const metadata = {
          actual: actual ?? null,
          band: axis.band,
          status: axis.status,
          measurement_only: axis.measurement_only ?? false,
        };

        if (actual === undefined) {
          return {
            score: 0,
            metadata: { ...metadata, error: `Missing metric: ${axis.metric}` },
          };
        }
        if (actual === null) {
          // Scores 0 in v0 like any out-of-band value, but reads as
          // "unmeasured", never as drift. Whether unmeasured should
          // instead be excluded from the case's score is a bar decision
          // (bar.md, vocal-variation open questions — Round 1).
          return { score: 0, metadata: { ...metadata, unmeasured: true } };
        }

        return {
          score: actual >= axis.band[0] && actual <= axis.band[1] ? 1 : 0,
          metadata,
        };
      },
    }),
);
