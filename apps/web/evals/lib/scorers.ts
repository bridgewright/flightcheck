import { createScorer } from "evalite";

import { barAxes } from "./bar";
import type { MorganMetricsCase } from "./load-metrics";

function resolveMetric(
  metrics: MorganMetricsCase["metrics"],
  metricPath: string,
): number | undefined {
  const [field, nestedField, ...remainder] = metricPath.split(".");
  if (remainder.length > 0) return undefined;

  const value = metrics[field];
  if (nestedField === undefined) {
    return typeof value === "number" ? value : undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const nestedValue = value[nestedField];
  return typeof nestedValue === "number" ? nestedValue : undefined;
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

        return {
          score: actual >= axis.band[0] && actual <= axis.band[1] ? 1 : 0,
          metadata,
        };
      },
    }),
);
