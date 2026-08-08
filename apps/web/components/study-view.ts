import type { ParaphraseItem } from "@/lib/types";

export const sessionHeading = (index: number): string => `Session ${String(index).padStart(2, "0")}`;

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
