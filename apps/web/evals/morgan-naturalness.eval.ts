import { evalite } from "evalite";

import { loadMetricsCases } from "./lib/load-metrics";
import { naturalnessScorers } from "./lib/scorers";

evalite("Morgan naturalness", {
  data: async () =>
    (await loadMetricsCases()).map((metricsCase) => ({ input: metricsCase })),
  task: async (input) => input,
  scorers: naturalnessScorers,
  columns: ({ input, scores }) => [
    { label: "Case", value: input.case_id },
    ...scores.map((score) => ({
      label: score.name,
      value: score.score ?? 0,
    })),
  ],
});
