// Pure view helpers for the progress screen, JSX-free so vitest exercises
// them directly. The trend MATH is lib/progress.ts (Phase 0) — this module
// only adds what the screen needs on top and was missing there:
//   - rubric metadata lookup (dimension name + channel by key),
//   - streak/recurrence counts behind the recurring-focus copy,
//   - trajectory-strip cell derivation and display formatting.
// Where a rule already exists in lib/progress.ts (scored-session ordering,
// bottom-two ranking, gap normalization) the SAME rule is restated here —
// those functions are private to lib/progress.ts, and the two must never
// drift apart or the focus copy would misdescribe the flagged issues.
import type { Channel, Rubric, SessionStatus, Verdict } from "@/lib/types";
import type { SessionProgressEntry } from "@/lib/worker";

// Rubric scores run 1..5 (BARS anchors); the bar-dot heights normalize to it.
export const SCORE_MAX = 5;

export interface DimensionMeta {
  name: string;
  channel: Channel | null;
}

/** Rubric dimension key -> display name + channel; empty when the rubric
 * fetch failed (callers fall back to humanized keys, no channel tag). */
export function dimensionMeta(
  rubric: Rubric | null | undefined,
): Record<string, DimensionMeta> {
  const meta: Record<string, DimensionMeta> = {};
  for (const dimension of rubric?.dimensions ?? []) {
    meta[dimension.key] = { name: dimension.name, channel: dimension.channel };
  }
  return meta;
}

/** "stakeholder_management" -> "Stakeholder management". The last-resort
 * label when the rubric (the real name source) is unreachable. */
export function humanizeDimensionKey(key: string): string {
  const words = key.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Net movement for display: "+0.5" / "-0.3" / "0.0" — one decimal, explicit
 * sign on gains, and never a signed zero ("-0.0" would read as a loss). */
export function formatSigned(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) {
    return "0.0";
  }
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

/** The scored sequence in session order — same rule as lib/progress.ts:
 * only "scored" rows carry dimension scores ("limited" reports included). */
export function scoredInOrder(
  entries: SessionProgressEntry[],
): SessionProgressEntry[] {
  return [...entries]
    .filter((entry) => entry.status === "scored")
    .sort((a, b) => a.index - b.index);
}

// The bottom two dimension keys by score, ties broken by rubric position —
// restates lib/progress.ts's private bottomTwoKeys exactly.
function bottomTwoKeys(entry: SessionProgressEntry): Set<string> {
  const ranked = entry.dimension_scores
    .map((d, position) => ({ key: d.dimension_key, score: d.score, position }))
    .sort((a, b) => a.score - b.score || a.position - b.position);
  return new Set(ranked.slice(0, 2).map((d) => d.key));
}

/**
 * How many scored sessions, counting back from the most recent one, kept the
 * dimension in the bottom two. Zero when the latest scored session did not —
 * the streak recurringIssues flagged ended earlier, and the copy must say so
 * rather than claim it is still running.
 */
export function trailingBottomTwoStreak(
  entries: SessionProgressEntry[],
  dimensionKey: string,
): number {
  const scored = scoredInOrder(entries);
  let streak = 0;
  for (let i = scored.length - 1; i >= 0; i--) {
    if (!bottomTwoKeys(scored[i]).has(dimensionKey)) {
      break;
    }
    streak++;
  }
  return streak;
}

// Normalized equality for gap strings — same rule as lib/progress.ts:
// case-insensitive, whitespace-collapsed, nothing fuzzier.
function normalizeGap(gap: string): string {
  return gap.trim().replace(/\s+/g, " ").toLowerCase();
}

/** In how many distinct sessions the gap was reported — the honest "{n}
 * reports" count next to a recurring gap. */
export function gapRecurrenceCount(
  entries: SessionProgressEntry[],
  gap: string,
): number {
  const wanted = normalizeGap(gap);
  let count = 0;
  for (const entry of entries) {
    if (entry.gaps.some((candidate) => normalizeGap(candidate) === wanted)) {
      count++;
    }
  }
  return count;
}

// One column of the trajectory strip: a session row where one exists, an
// empty still-owed slot where none does.
export type TrajectoryCell =
  | {
      kind: "session";
      index: number;
      status: SessionStatus;
      verdict: Verdict | null;
      overall: number | null;
    }
  | { kind: "empty"; index: number };

/**
 * One cell per session the package owes, 1..totalSessions. Rows numbered
 * outside that range are ignored — same reasoning as lib/home.ts's
 * withinPackage: a strip of totalSessions slots cannot draw them.
 */
export function trajectoryCells(
  entries: SessionProgressEntry[],
  totalSessions: number,
): TrajectoryCell[] {
  const byIndex = new Map<number, SessionProgressEntry>();
  for (const entry of entries) {
    if (Number.isInteger(entry.index) && entry.index >= 1 && entry.index <= totalSessions) {
      byIndex.set(entry.index, entry);
    }
  }
  return Array.from({ length: Math.max(totalSessions, 0) }, (_, i) => {
    const index = i + 1;
    const entry = byIndex.get(index);
    if (entry === undefined) {
      return { kind: "empty", index };
    }
    return {
      kind: "session",
      index,
      status: entry.status,
      verdict: entry.verdict,
      overall: entry.overall,
    };
  });
}
