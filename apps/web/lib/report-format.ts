// Pure formatting helpers for session reports. Kept JSX-free so vitest can
// exercise them without a React transform.
import type { SessionStatus, TimestampedObservation, Verdict } from "@/lib/types";

export const VERDICT_LABELS: Record<Verdict, string> = {
  not_ready: "Not yet ready",
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

// The same red/amber/green language as the verdict box, at pill size — the
// archive rows and detail chips speak one color vocabulary.
const VERDICT_PILL_CLASSES: Record<Verdict, string> = {
  not_ready: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  approaching:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  ready: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
};

export function verdictPillClasses(verdict: Verdict): string {
  return VERDICT_PILL_CLASSES[verdict];
}

/**
 * A score delta for display: "+0.4", "-0.3", or "0.0". Sign follows the
 * ROUNDED value, so a delta that displays as 0.0 never carries a misleading
 * "+" or "-".
 */
export function formatDelta(delta: number): string {
  const rounded = delta.toFixed(1);
  if (rounded === "0.0" || rounded === "-0.0") {
    return "0.0";
  }
  return delta > 0 ? `+${rounded}` : rounded;
}

/**
 * Per-row overall delta vs the PREVIOUS SCORED session, keyed by session id.
 * Rows without a delta (the first scored session, and anything unscored) are
 * simply absent. Unscored rows never break the chain — the comparison is
 * always against the last session that produced a number.
 */
export function overallDeltas(
  sessions: {
    id: string;
    index: number;
    status: SessionStatus;
    overall: number | null;
  }[],
): Map<string, number> {
  const deltas = new Map<string, number>();
  const scored = sessions
    .filter((s) => s.status === "scored" && s.overall !== null)
    .sort((a, b) => a.index - b.index);
  for (let i = 1; i < scored.length; i++) {
    deltas.set(scored[i].id, (scored[i].overall as number) - (scored[i - 1].overall as number));
  }
  return deltas;
}

/**
 * The archive's status cell for a row without a verdict: what happened to the
 * session, said plainly. Scored rows return null — they carry a verdict pill
 * (verdictPillClasses) and a number instead of a status.
 */
const ARCHIVE_STATUS_PILLS: Record<
  SessionStatus,
  { label: string; className: string } | null
> = {
  planned: {
    label: "Not started — slot preserved",
    className:
      "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  },
  scoring: {
    label: "Scoring…",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  failed: {
    label: "Scoring failed",
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
  failed_permanent: {
    label: "Closed — not scored",
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
  insufficient: {
    label: "Not scored — not enough evidence",
    className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
  scored: null,
};

export function archiveStatusPill(
  status: SessionStatus,
): { label: string; className: string } | null {
  return ARCHIVE_STATUS_PILLS[status];
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

/**
 * The observations worth surfacing before "show all": every DSP conflict
 * (a judge-vs-measurement disagreement is always worth reading) plus the
 * earliest of the rest up to `max`, returned in timeline order. The full
 * list stays one disclosure away — trimmed display, no data loss.
 */
export function topObservations(
  observations: TimestampedObservation[],
  max: number,
): TimestampedObservation[] {
  const conflicts = observations.filter((o) => o.conflicts_with_dsp);
  const rest = observations.filter((o) => !o.conflicts_with_dsp);
  const picked = new Set([...conflicts, ...rest].slice(0, max));
  return observations.filter((o) => picked.has(o));
}
