import type { PackageBookmarks, ParaphraseItem, StudySummary } from "@/lib/types";

export const sessionHeading = (index: number): string => `Session ${String(index).padStart(2, "0")}`;

// Which sections have something to say. Empty is the normal case rather than
// the edge one — the generator drops every model answer whose quotes it
// cannot find in the candidate's own words, so a guide with zero
// jd_core_answers is a routine outcome, not a broken one. A section heading
// with nothing under it reads as a page that failed to load.
export const hasSummary = (summary: StudySummary): boolean =>
  summary.core_problems.length > 0
  || summary.improvement_strategy.length > 0
  || summary.priority_expressions.length > 0;

// The worker already omits sessions with no bookmarks; this is the renderer
// refusing to draw an empty session heading if that ever stops being true.
export const savedSessions = (bookmarks: PackageBookmarks | null): PackageBookmarks["sessions"] =>
  (bookmarks?.sessions ?? []).filter((session) => session.items.length > 0);

export const expressionPair = (item: ParaphraseItem) => ({
  original: item.source_quote,
  stronger: item.suggestion,
  why: item.why,
});

export const studyExportFilename = (generatedAt: string): string => {
  const parsed = new Date(generatedAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
  return `flightcheck-study-${date}`;
};
