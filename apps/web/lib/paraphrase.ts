import type { TimelineEntry, TranscriptTurn } from "@/lib/transcript";
import type { ParaphraseFlag, ParaphraseItem, ParaphraseMark, ParaphraseMarks, SessionParaphrases, TimestampedObservation } from "@/lib/types";

export type TimelineEntryWithCoaching =
  | { kind: "turn"; turn: TranscriptTurn; candidateOrdinal: number | null; item: ParaphraseItem | null }
  | { kind: "observation"; observation: TimestampedObservation };

export const COACHING_MIN_WORDS = 8;

export function coachingEligible(turn: TranscriptTurn): boolean {
  return turn.text.trim().split(/\s+/).filter(Boolean).length >= COACHING_MIN_WORDS;
}

export function attachCoaching(timeline: TimelineEntry[], paraphrases: SessionParaphrases | null | undefined, derivedCandidateTurnCount: number): TimelineEntryWithCoaching[] {
  const usable = paraphrases !== null && paraphrases !== undefined && paraphrases.turn_count === derivedCandidateTurnCount;
  const byOrdinal = new Map<number, ParaphraseItem>();
  if (usable) {
    for (const item of paraphrases.items) {
      if (item.turn_index >= 0 && item.turn_index < derivedCandidateTurnCount && !byOrdinal.has(item.turn_index)) byOrdinal.set(item.turn_index, item);
    }
  }
  let ordinal = 0;
  return timeline.map((entry) => {
    if (entry.kind === "observation") return entry;
    const candidateOrdinal = entry.turn.speaker === "candidate" ? ordinal++ : null;
    return {
      ...entry,
      candidateOrdinal,
      item: candidateOrdinal === null || !coachingEligible(entry.turn)
        ? null
        : (byOrdinal.get(candidateOrdinal) ?? null),
    };
  });
}

export function markFor(marks: ParaphraseMarks | null | undefined, ordinal: number): ParaphraseMark {
  const mark = marks?.marks[String(ordinal)];
  return mark ? { ...mark, flag: mark.flag ?? null } : { reaction: null, bookmarked: false, flag: null };
}

export function nextMarkForBookmark(mark: ParaphraseMark): ParaphraseMark {
  return { ...mark, bookmarked: !mark.bookmarked };
}

export function nextMarkForFlag(mark: ParaphraseMark, flag: ParaphraseFlag | null): ParaphraseMark {
  return { ...mark, flag };
}

export const PARAPHRASE_FLAG_REASONS = [
  "misheard",
  "inappropriate",
  "inaccurate",
  "missing",
  "other",
] as const;

export const FLAG_NOTE_MAX_CHARS = 500;

/**
 * Validates a client-supplied flag and REBUILDS it field by field, so
 * unknown keys never travel to the worker (whose schema forbids them).
 * A missing flag reads as null: a stale client that predates the field
 * must keep working. "invalid" is a sentinel, never thrown here — the
 * caller decides how to refuse.
 */
export function sanitizedFlag(flag: unknown): ParaphraseFlag | null | "invalid" {
  if (flag === null || flag === undefined) return null;
  if (typeof flag !== "object" || Array.isArray(flag)) return "invalid";
  const { reason, note } = flag as { reason?: unknown; note?: unknown };
  if (typeof reason !== "string") return "invalid";
  if (!(PARAPHRASE_FLAG_REASONS as readonly string[]).includes(reason)) return "invalid";
  if (typeof note !== "string" || note.length > FLAG_NOTE_MAX_CHARS) return "invalid";
  if (reason === "other" && note.trim() === "") return "invalid";
  return { reason: reason as ParaphraseFlag["reason"], note };
}

export function bookmarkedItems(paraphrases: SessionParaphrases | null | undefined, marks: ParaphraseMarks | null | undefined): { ordinal: number; item: ParaphraseItem }[] {
  if (!paraphrases) return [];
  return paraphrases.items.filter((item) => markFor(marks, item.turn_index).bookmarked).map((item) => ({ ordinal: item.turn_index, item }));
}

export function sourceQuoteIfVerbatim(turn: TranscriptTurn, quote: string): string | null {
  return quote.length > 0 && turn.text.includes(quote) ? quote : null;
}
