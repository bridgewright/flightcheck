import { defineConfig } from "evalite/config";

export default defineConfig({
  scoreThreshold: 0,
  forceRerunTriggers: [
    "evals/lib/**/*.ts",
    "evals/fixtures/**/*.json",
    "../../evals/out/morgan_naturalness/*.metrics.json",
    "../../evals/suites/morgan_naturalness/bar.thresholds.json",
  ],
});
