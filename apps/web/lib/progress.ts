// Pure trend math over the worker's progress entries (lib/worker.ts
// SessionProgressEntry). Shared by the progress screen and the session
// detail's delta header. Everything here is deterministic: no fuzzy
// matching, no thresholds invented in the UI. Deltas are raw arithmetic —
// callers format (and round) for display.
import type { SessionProgressEntry } from "@/lib/worker";

export interface TrendPoint {
  session_id: string;
  index: number;
  score: number;
}

export interface DimensionTrend {
  dimension_key: string;
  // One point per scored session carrying the dimension, ascending index.
  points: TrendPoint[];
  // Last score minus first; 0 with fewer than two points.
  net: number;
}

export interface DeltaVsPrevious {
  latest_session_id: string;
  previous_session_id: string;
  // Null when either session lacks an overall score.
  overall: number | null;
  // Per-dimension delta, only for keys present in BOTH sessions.
  dimensions: Record<string, number>;
}

export interface RecurringIssues {
  // Gap strings recurring across >= 2 sessions (normalized string equality;
  // first-seen original text, order of first appearance).
  gaps: string[];
  // Dimension keys in the bottom two by score of >= 2 consecutive scored
  // sessions, order of first qualification.
  weakDimensions: string[];
}

// The scored sequence in session order: only these carry dimension scores.
// "limited" evidence reports still have status "scored" and belong here.
function scoredInOrder(entries: SessionProgressEntry[]): SessionProgressEntry[] {
  return [...entries]
    .filter((entry) => entry.status === "scored")
    .sort((a, b) => a.index - b.index);
}

export function dimensionTrends(entries: SessionProgressEntry[]): DimensionTrend[] {
  const trends: DimensionTrend[] = [];
  const byKey = new Map<string, DimensionTrend>();
  for (const entry of scoredInOrder(entries)) {
    for (const { dimension_key, score } of entry.dimension_scores) {
      let trend = byKey.get(dimension_key);
      if (trend === undefined) {
        // Dimension order = first appearance, i.e. the rubric's own order as
        // serialized by the worker.
        trend = { dimension_key, points: [], net: 0 };
        byKey.set(dimension_key, trend);
        trends.push(trend);
      }
      trend.points.push({ session_id: entry.session_id, index: entry.index, score });
    }
  }
  for (const trend of trends) {
    trend.net =
      trend.points.length >= 2
        ? trend.points[trend.points.length - 1].score - trend.points[0].score
        : 0;
  }
  return trends;
}

export function deltaVsPrevious(
  entries: SessionProgressEntry[],
): DeltaVsPrevious | null {
  const scored = scoredInOrder(entries);
  if (scored.length < 2) {
    return null;
  }
  const previous = scored[scored.length - 2];
  const latest = scored[scored.length - 1];
  const previousScores = new Map(
    previous.dimension_scores.map((d) => [d.dimension_key, d.score]),
  );
  const dimensions: Record<string, number> = {};
  for (const { dimension_key, score } of latest.dimension_scores) {
    const before = previousScores.get(dimension_key);
    if (before !== undefined) {
      dimensions[dimension_key] = score - before;
    }
  }
  return {
    latest_session_id: latest.session_id,
    previous_session_id: previous.session_id,
    overall:
      latest.overall !== null && previous.overall !== null
        ? latest.overall - previous.overall
        : null,
    dimensions,
  };
}

// Normalized equality for gap strings: case-insensitive, whitespace-collapsed.
// Deliberately nothing smarter — a rewording is a different gap.
function normalizeGap(gap: string): string {
  return gap.trim().replace(/\s+/g, " ").toLowerCase();
}

// The bottom two dimension keys by score; ties break by rubric position so
// the result never depends on sort stability details.
function bottomTwoKeys(entry: SessionProgressEntry): Set<string> {
  const ranked = entry.dimension_scores
    .map((d, position) => ({ key: d.dimension_key, score: d.score, position }))
    .sort((a, b) => a.score - b.score || a.position - b.position);
  return new Set(ranked.slice(0, 2).map((d) => d.key));
}

export function recurringIssues(entries: SessionProgressEntry[]): RecurringIssues {
  // Recurring gaps: count DISTINCT sessions containing each normalized gap.
  const firstSeen = new Map<string, string>(); // normalized -> original text
  const sessionCounts = new Map<string, number>();
  const ordered = [...entries].sort((a, b) => a.index - b.index);
  for (const entry of ordered) {
    const inThisSession = new Set(entry.gaps.map(normalizeGap));
    for (const normalized of inThisSession) {
      if (!firstSeen.has(normalized)) {
        const original = entry.gaps.find((g) => normalizeGap(g) === normalized);
        firstSeen.set(normalized, original ?? normalized);
      }
      sessionCounts.set(normalized, (sessionCounts.get(normalized) ?? 0) + 1);
    }
  }
  const gaps: string[] = [];
  for (const [normalized, original] of firstSeen) {
    if ((sessionCounts.get(normalized) ?? 0) >= 2) {
      gaps.push(original);
    }
  }

  // Recurring weak dimensions: bottom-2 in >= 2 CONSECUTIVE scored sessions.
  // "Consecutive" is over the scored sequence — sessions with no scores at
  // all (failed/insufficient/planned) do not break a streak.
  const scored = scoredInOrder(entries);
  const weakDimensions: string[] = [];
  const flagged = new Set<string>();
  for (let i = 0; i + 1 < scored.length; i++) {
    const current = bottomTwoKeys(scored[i]);
    for (const key of bottomTwoKeys(scored[i + 1])) {
      if (current.has(key) && !flagged.has(key)) {
        flagged.add(key);
        weakDimensions.push(key);
      }
    }
  }
  return { gaps, weakDimensions };
}
