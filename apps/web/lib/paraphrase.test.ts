import { describe, expect, it } from "vitest";

import { COACHING_MIN_WORDS, attachCoaching, bookmarkedItems, coachingEligible, markFor, nextMarkForBookmark, nextMarkForFlag, sourceQuoteIfVerbatim } from "@/lib/paraphrase";
import type { TimelineEntry, TranscriptTurn } from "@/lib/transcript";

const timeline: TimelineEntry[] = [
  { kind: "turn", turn: { speaker: "candidate", start_s: 0, end_s: 2, text: "One merged answer with enough words for useful coaching" } },
  { kind: "observation", observation: { at_s: 1, kind: "pace", note: "Fast", conflicts_with_dsp: false } },
  { kind: "turn", turn: { speaker: "interviewer", start_s: 2, end_s: 3, text: "Next" } },
  { kind: "turn", turn: { speaker: "candidate", start_s: 3, end_s: 4, text: "Second answer with enough words for useful coaching here" } },
];

const paraphrases = { schema_version: 1, generated_at: "now", turn_count: 2, items: [
  { turn_index: 1, verdict: "good" as const, source_quote: "Second", suggestion: "Better", why: "Why" },
  { turn_index: 9, verdict: "good" as const, source_quote: "", suggestion: "", why: "" },
] };

describe("attachCoaching", () => {
  it("uses candidate ordinals and observations do not shift them", () => {
    const result = attachCoaching(timeline, paraphrases, 2);
    expect(result[0]).toMatchObject({ candidateOrdinal: 0, item: null });
    expect(result[1].kind).toBe("observation");
    expect(result[2]).toMatchObject({ candidateOrdinal: null, item: null });
    expect(result[3]).toMatchObject({ candidateOrdinal: 1, item: paraphrases.items[0] });
  });

  it("attaches nothing when grouping counts drift", () => {
    expect(attachCoaching(timeline, paraphrases, 3).filter((entry) => entry.kind === "turn").every((entry) => entry.item === null)).toBe(true);
  });

  it("does not attach coaching to answers below the word floor", () => {
    const shortTimeline: TimelineEntry[] = [{
      kind: "turn",
      turn: { speaker: "candidate", start_s: 0, end_s: 1, text: "Too short to coach" },
    }];
    const shortDoc = { ...paraphrases, turn_count: 1, items: [{ ...paraphrases.items[0], turn_index: 0 }] };

    expect(attachCoaching(shortTimeline, shortDoc, 1)[0]).toMatchObject({ item: null });
  });
});

describe("coachingEligible", () => {
  it("uses a whitespace-split minimum of eight words", () => {
    expect(COACHING_MIN_WORDS).toBe(8);
    expect(coachingEligible({ speaker: "candidate", start_s: 0, end_s: 1, text: "one two three four five six seven" })).toBe(false);
    expect(coachingEligible({ speaker: "candidate", start_s: 0, end_s: 1, text: "one  two\nthree four five six seven eight" })).toBe(true);
  });
});

describe("attachCoaching drops what it cannot place", () => {
  it("ignores an out-of-range index rather than shifting it onto a real turn", () => {
    const result = attachCoaching(timeline, paraphrases, 2);
    expect(result.filter((entry) => entry.kind === "turn" && entry.item !== null)).toHaveLength(1);
  });

  it("keeps the first item when a turn is claimed twice", () => {
    const duplicated = { ...paraphrases, items: [
      { turn_index: 0, verdict: "good" as const, source_quote: "One", suggestion: "first", why: "w" },
      { turn_index: 0, verdict: "improve" as const, source_quote: "One", suggestion: "second", why: "w" },
    ] };
    const result = attachCoaching(timeline, duplicated, 2);
    expect(result[0]).toMatchObject({ item: { suggestion: "first" } });
  });

  it("attaches nothing when there are no paraphrases at all", () => {
    for (const doc of [null, undefined]) {
      const result = attachCoaching(timeline, doc, 2);
      expect(result.filter((entry) => entry.kind === "turn").every((entry) => entry.item === null)).toBe(true);
      // Ordinals are still assigned: they describe the transcript, not the coaching.
      expect(result[0]).toMatchObject({ candidateOrdinal: 0 });
      expect(result[3]).toMatchObject({ candidateOrdinal: 1 });
    }
  });
});

const marks = { schema_version: 1, marks: {
  "1": { reaction: "up" as const, bookmarked: true, flag: null },
  "0": { reaction: null, bookmarked: false, flag: null },
} };

describe("markFor", () => {
  it("defaults to an unmarked card", () => {
    expect(markFor(undefined, 2)).toEqual({ reaction: null, bookmarked: false, flag: null });
    expect(markFor(null, 0)).toEqual({ reaction: null, bookmarked: false, flag: null });
    expect(markFor(marks, 7)).toEqual({ reaction: null, bookmarked: false, flag: null });
  });

  it("reads a stored mark by its string ordinal key", () => {
    expect(markFor(marks, 1)).toEqual({ reaction: "up", bookmarked: true, flag: null });
  });
});

describe("mark transitions", () => {
  it("toggles only the bookmark", () => {
    expect(nextMarkForBookmark({ reaction: "up", bookmarked: true, flag: null }))
      .toEqual({ reaction: "up", bookmarked: false, flag: null });
  });

  it("sets and clears a flag without changing legacy reactions or bookmarks", () => {
    const mark = { reaction: "down" as const, bookmarked: true, flag: null };
    const flag = { reason: "misheard" as const, note: "The name was wrong" };
    expect(nextMarkForFlag(mark, flag)).toEqual({ ...mark, flag });
    expect(nextMarkForFlag({ ...mark, flag }, null)).toEqual(mark);
  });
});

describe("bookmarkedItems", () => {
  it("collects only the bookmarked cards, with their ordinals", () => {
    expect(bookmarkedItems(paraphrases, marks)).toEqual([
      { ordinal: 1, item: paraphrases.items[0] },
    ]);
  });

  it("is empty without paraphrases or without marks", () => {
    expect(bookmarkedItems(null, marks)).toEqual([]);
    expect(bookmarkedItems(paraphrases, null)).toEqual([]);
  });

  it("does not treat a thumbs-up as a bookmark", () => {
    const reactedOnly = { schema_version: 1, marks: {
      "1": { reaction: "up" as const, bookmarked: false, flag: null },
    } };
    expect(bookmarkedItems(paraphrases, reactedOnly)).toEqual([]);
  });

  it("keeps an already-bookmarked short answer", () => {
    const shortTimeline: TimelineEntry[] = [{
      kind: "turn",
      turn: { speaker: "candidate", start_s: 0, end_s: 1, text: "Brief saved reply" },
    }];
    const short = { ...paraphrases, turn_count: 1, items: [{ ...paraphrases.items[0], turn_index: 0 }] };
    const shortMarks = { schema_version: 1, marks: { "0": { reaction: null, bookmarked: true, flag: null } } };

    expect(attachCoaching(shortTimeline, short, 1)[0]).toMatchObject({ item: null });
    expect(bookmarkedItems(short, shortMarks)).toEqual([{ ordinal: 0, item: short.items[0] }]);
  });
});

describe("sourceQuoteIfVerbatim", () => {
  const turn: TranscriptTurn = { speaker: "candidate", start_s: 0, end_s: 1, text: "exact words" };

  it("returns the quote only when the turn really contains it", () => {
    expect(sourceQuoteIfVerbatim(turn, "exact")).toBe("exact");
    expect(sourceQuoteIfVerbatim(turn, "exact words")).toBe("exact words");
  });

  it("refuses a quote the turn does not contain, rather than showing a misquote", () => {
    expect(sourceQuoteIfVerbatim(turn, "invented")).toBeNull();
    expect(sourceQuoteIfVerbatim(turn, "Exact")).toBeNull();   // case is not a match
    expect(sourceQuoteIfVerbatim(turn, "")).toBeNull();        // empty is not a quote
  });
});
