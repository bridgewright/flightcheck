import { describe, expect, it } from "vitest";
import { studyMarkdown } from "@/lib/study-markdown";

describe("study markdown", () => {
  it("preserves saved expressions verbatim", () => {
    const doc = { schema_version: 1, source_session_ids: ["s1"], summary: { core_problems: [], improvement_strategy: [], priority_expressions: [] }, jd_core_answers: [] };
    const bookmarks = { package_id: "p1", sessions: [{ session_id: "s1", session_index: 1, items: [{ turn_index: 2, verdict: "improve" as const, source_quote: "my exact words", suggestion: "A stronger answer", why: "More specific" }] }] };
    expect(studyMarkdown(doc, bookmarks, { roleTitle: "PM", generatedAt: "2026-08-08" })).toContain("my exact words");
  });
});
