// Pure formatting helpers for session reports. Kept JSX-free so vitest can
// exercise them without a React transform.
import type { SessionStatus, TimestampedObservation, Verdict } from "@/lib/types";
import { CHIP, CHIP_ALARM, CHIP_BLUSH, CHIP_READY } from "@/lib/ui";

export const VERDICT_LABELS: Record<Verdict, string> = {
  not_ready: "Not yet ready",
  approaching: "Approaching",
  ready: "Ready",
};

// The verdict at pill size, on the tokens.
//
// It used to be red / amber / green, matching a coloured verdict band that no
// longer exists. Both are gone for the same reason: a verdict is not a traffic
// light. Rendering "Not yet ready" in red punishes exactly the reader this
// product is for, and colour-coded certainty is on the competitive dossier's
// AVOID list because it is how exam-band products manufacture confidence they
// have not earned.
//
// So sage marks Ready, because arriving is worth marking, and the other two
// are plain. What separates them on the screen is the word.
const VERDICT_PILL_CLASSES: Record<Verdict, string> = {
  not_ready: CHIP,
  approaching: CHIP,
  ready: CHIP_READY,
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
  planned: { label: "Not started, slot preserved", className: CHIP },
  // In progress, which is what blush marks everywhere in the product.
  scoring: { label: "Scoring…", className: CHIP_BLUSH },
  // These three are real failures of ours, which is the one job alarm has.
  // One separator between them, deliberately: they render as siblings in the
  // same column, and a comma, a colon, and nothing at all across three
  // adjacent pills reads as three different voices.
  failed: { label: "Scoring failed", className: CHIP_ALARM },
  failed_permanent: { label: "Closed, not scored", className: CHIP_ALARM },
  insufficient: {
    label: "Not scored, not enough evidence",
    className: CHIP_ALARM,
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
