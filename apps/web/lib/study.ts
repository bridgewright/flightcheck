import type { PackageStudy } from "@/lib/types";
import type { SessionProgressEntry } from "@/lib/worker";

export type StudyPageState = "no_sessions" | "not_generated" | "generating" | "failed" | "stale" | "fresh";

export function scoredCount(entries: SessionProgressEntry[]): number {
  return entries.filter((entry) => entry.overall !== null && entry.status === "scored").length;
}

export function studyState(study: PackageStudy | null, count: number): StudyPageState {
  if (count === 0) return "no_sessions";
  if (study === null || study.status === "none") return "not_generated";
  if (study.status === "generating") return "generating";
  if (study.status === "failed") return "failed";
  return study.stale ? "stale" : "fresh";
}

export function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function staleLine(generatedAt: string, scoredNow: number): string {
  return `Built ${formatGeneratedAt(generatedAt)} from an earlier set of sessions. You now have ${scoredNow} scored ${scoredNow === 1 ? "session" : "sessions"}.`;
}
