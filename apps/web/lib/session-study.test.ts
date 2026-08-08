import { describe, expect, it } from "vitest";

import { qaSets, sessionStudyMarkdown } from "@/lib/session-study";
import type { SessionCoaching, SessionInsights, TranscriptSegment } from "@/lib/types";

const segments: TranscriptSegment[] = [
  { start_s: 0, end_s: 1, speaker: "interviewer", text: "Tell me about" },
  { start_s: 1, end_s: 2, speaker: "interviewer", text: "a difficult launch." },
  { start_s: 2, end_s: 4, speaker: "candidate", text: "I aligned three teams and shipped on time." },
  { start_s: 5, end_s: 6, speaker: "interviewer", text: "What changed?" },
  { start_s: 6, end_s: 8, speaker: "candidate", text: "Support volume fell by eighteen percent." },
];

const coaching: SessionCoaching = {
  session_id: "s-1",
  paraphrases: {
    schema_version: 1,
    generated_at: "2026-08-08",
    turn_count: 2,
    items: [
      { turn_index: 0, verdict: "improve", source_quote: "shipped on time", suggestion: "I aligned three teams and shipped by the committed date.", why: "Names the coordination and result." },
      { turn_index: 1, verdict: "good", source_quote: "eighteen percent", suggestion: "Support volume fell by eighteen percent after launch.", why: "Keeps the measurable outcome." },
      { turn_index: 9, verdict: "good", source_quote: "", suggestion: "Out of range", why: "Drop it." },
    ],
  },
  insights: null,
  marks: { schema_version: 1, marks: {
    "0": { reaction: null, bookmarked: true, flag: null },
    "1": { reaction: "up", bookmarked: true, flag: null },
    "9": { reaction: null, bookmarked: true, flag: null },
  } },
};

describe("qaSets", () => {
  it("pairs bookmarks with the nearest merged interviewer question and full answer", () => {
    expect(qaSets(segments, coaching)).toEqual([
      {
        ordinal: 0,
        question: "Tell me about a difficult launch.",
        your_answer: "I aligned three teams and shipped on time.",
        better: "I aligned three teams and shipped by the committed date.",
        why: "Names the coordination and result.",
      },
      {
        ordinal: 1,
        question: "What changed?",
        your_answer: "Support volume fell by eighteen percent.",
        better: "Support volume fell by eighteen percent after launch.",
        why: "Keeps the measurable outcome.",
      },
    ]);
  });

  it("uses a null question when the session opens with the candidate", () => {
    expect(qaSets(segments.slice(2, 3), { ...coaching, paraphrases: { ...coaching.paraphrases!, turn_count: 1, items: coaching.paraphrases!.items.slice(0, 1) } })[0].question).toBeNull();
  });

  it("drops bookmarks whose ordinal exceeds the derived candidate turns", () => {
    expect(qaSets(segments, coaching)).toHaveLength(2);
  });

  it("attaches nothing when scorer and web candidate counts drift", () => {
    expect(qaSets(segments, { ...coaching, paraphrases: { ...coaching.paraphrases!, turn_count: 99 } })).toEqual([]);
  });
});

const insights: SessionInsights = {
  schema_version: 1,
  generated_at: "2026-08-08",
  did_well: ["Used a clear metric."],
  did_poorly: ["The opening lacked context."],
  must_keep: [{ turn_index: 1, said_verbatim: "eighteen percent", better: "Support volume fell by eighteen percent.", why: "Specific." }],
  must_answer: [{ question: "Why this role?", model_answer: "Connect the role to customer outcomes.", based_on_quotes: ["I enjoy customer work."] }],
};
const meta = { sessionNumber: 2, sessionDate: "2026-08-08", roleTitle: "FDPM", generatedDate: "2026-08-08" };

describe("sessionStudyMarkdown", () => {
  it("renders question and answer sections verbatim in preparation order", () => {
    const output = sessionStudyMarkdown(qaSets(segments, coaching), insights, meta);
    expect(output).toContain("# flightcheck study notes");
    expect(output).toContain("Session 2 | 2026-08-08 | FDPM");
    expect(output).toContain("## Q. Tell me about a difficult launch.");
    expect(output).toContain("**Better answer.** I aligned three teams and shipped by the committed date.");
    expect(output).toContain("## Core questions to prepare");
    expect(output).toContain("## Expressions worth keeping");
    expect(output).toContain("## Session review");
  });

  it("omits every empty optional section", () => {
    const output = sessionStudyMarkdown([], null, { ...meta, roleTitle: null });
    expect(output).toBe("# flightcheck study notes\n\nSession 2 | 2026-08-08 | Interview role\n\nGenerated 2026-08-08.\n");
    expect(output).not.toContain("## ");
  });
});
