import type { SessionProgressEntry } from "@/lib/worker";

export interface OverallPoint {
  index: number;
  score: number;
}

export function overallTrend(entries: SessionProgressEntry[]): OverallPoint[] {
  return entries
    .filter(
      (entry): entry is SessionProgressEntry & { overall: number } =>
        entry.status === "scored" && entry.overall !== null,
    )
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({ index: entry.index, score: entry.overall }));
}

export function overallNet(points: OverallPoint[]): number {
  return points.length < 2
    ? 0
    : points[points.length - 1].score - points[0].score;
}

export function trendSectionVisible(entries: SessionProgressEntry[]): boolean {
  return overallTrend(entries).length >= 2;
}
