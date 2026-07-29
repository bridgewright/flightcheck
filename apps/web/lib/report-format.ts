// Pure formatting helpers for session reports. Kept JSX-free so vitest can
// exercise them without a React transform.
import type { Verdict } from "@/lib/types";

export const VERDICT_LABELS: Record<Verdict, string> = {
  not_ready: "Not ready yet",
  approaching: "Approaching",
  ready: "Ready",
};

const VERDICT_CLASSES: Record<Verdict, string> = {
  not_ready:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  approaching:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  ready:
    "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
};

export function verdictClasses(verdict: Verdict): string {
  return VERDICT_CLASSES[verdict];
}

export function formatTimestamp(atS: number): string {
  const total = Math.floor(atS);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatLatency(latencyS: number | null): string {
  return latencyS === null ? "n/a" : `${latencyS.toFixed(1)}s`;
}

// Worker scoring stages (sessions.scoring_stage, set by scorer's
// score_session pipeline) -> progress copy for the report page's scoring
// branch. Keyed by string, not a union: a newer worker may emit a stage this
// build does not know, and that must degrade to the generic line, not crash.
const SCORING_STAGE_COPY: Record<string, string> = {
  download: "Fetching your recording…",
  transcribe: "Transcribing the conversation…",
  "delivery-metrics": "Measuring pace, fillers, and intonation…",
  "content-judge": "Scoring answers against the rubric…",
  "delivery-judge": "Reviewing how it sounded…",
  compile: "Compiling your report…",
};

export function scoringStageCopy(stage: string | null | undefined): string | null {
  return stage == null ? null : (SCORING_STAGE_COPY[stage] ?? null);
}
