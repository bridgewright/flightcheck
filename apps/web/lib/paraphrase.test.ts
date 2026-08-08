import { describe, expect, it } from "vitest";

import { attachCoaching, markFor, sourceQuoteIfVerbatim } from "@/lib/paraphrase";
import type { TimelineEntry } from "@/lib/transcript";

const timeline: TimelineEntry[] = [
  { kind: "turn", turn: { speaker: "candidate", start_s: 0, end_s: 2, text: "One merged answer" } },
  { kind: "observation", observation: { at_s: 1, kind: "pace", note: "Fast", conflicts_with_dsp: false } },
  { kind: "turn", turn: { speaker: "interviewer", start_s: 2, end_s: 3, text: "Next" } },
  { kind: "turn", turn: { speaker: "candidate", start_s: 3, end_s: 4, text: "Second answer" } },
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
});

it("defaults marks and guards verbatim quotes", () => {
  expect(markFor(undefined, 2)).toEqual({ reaction: null, bookmarked: false });
  expect(sourceQuoteIfVerbatim({ speaker: "candidate", start_s: 0, end_s: 1, text: "exact words" }, "exact")).toBe("exact");
  expect(sourceQuoteIfVerbatim({ speaker: "candidate", start_s: 0, end_s: 1, text: "exact words" }, "invented")).toBeNull();
});
