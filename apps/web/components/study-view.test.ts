// Display derivations the study components would otherwise compute inline.
// They live outside the .tsx so they can be tested without a renderer — this
// suite has no DOM.
import { describe, expect, it } from "vitest";

import {
  expressionPair,
  hasSummary,
  savedSessions,
  sessionHeading,
  studyExportFilename,
} from "@/components/study-view";
import type { PackageBookmarks, ParaphraseItem, StudySummary } from "@/lib/types";

describe("sessionHeading", () => {
  it("pads a single digit so a list of sessions aligns", () => {
    expect(sessionHeading(2)).toBe("Session 02");
  });

  it("leaves a two-digit index alone", () => {
    // Six sessions per package today; the padding must not corrupt a number
    // that already has two digits if that ever changes.
    expect(sessionHeading(12)).toBe("Session 12");
  });
});

describe("expressionPair", () => {
  it("names the two halves the card renders", () => {
    // The verbatim quote and the stronger rewrite are deliberately separate
    // fields: the card puts the customer's own words in the quote position
    // and the suggestion in the ink position, never the other way round.
    const item: ParaphraseItem = {
      turn_index: 4,
      verdict: "improve",
      source_quote: "we shipped it fast",
      suggestion: "We shipped in six weeks with two engineers.",
      why: "The constraint is the impressive part.",
    };

    expect(expressionPair(item)).toEqual({
      original: "we shipped it fast",
      stronger: "We shipped in six weeks with two engineers.",
      why: "The constraint is the impressive part.",
    });
  });
});

describe("which sections have something to say", () => {
  const summary = (overrides: Partial<StudySummary> = {}): StudySummary => ({
    core_problems: [],
    improvement_strategy: [],
    priority_expressions: [],
    ...overrides,
  });

  it("is false only when all three lists are empty", () => {
    // A guide can legitimately come back with nothing in a section: the
    // generator drops any core problem citing a dimension outside the rubric.
    // The heading must go with the content, not stand over an empty space.
    expect(hasSummary(summary())).toBe(false);
    expect(hasSummary(summary({ core_problems: [
      { title: "t", description: "d", dimension_keys: ["k"] },
    ] }))).toBe(true);
    expect(hasSummary(summary({ improvement_strategy: ["step"] }))).toBe(true);
    expect(hasSummary(summary({ priority_expressions: ["phrase"] }))).toBe(true);
  });

  it("drops sessions whose bookmarks are all gone", () => {
    const item = {
      turn_index: 1,
      verdict: "improve" as const,
      source_quote: "q",
      suggestion: "s",
      why: "w",
    };
    const bookmarks: PackageBookmarks = {
      package_id: "pkg-1",
      sessions: [
        { session_id: "sess-1", session_index: 1, items: [] },
        { session_id: "sess-2", session_index: 2, items: [item] },
      ],
    };

    expect(savedSessions(bookmarks).map((session) => session.session_id)).toEqual(["sess-2"]);
  });

  it("treats an unreachable bookmarks join as nothing saved", () => {
    expect(savedSessions(null)).toEqual([]);
  });
});

describe("studyExportFilename", () => {
  it("names the file by the date the guide was generated", () => {
    expect(studyExportFilename("2026-08-08T12:00:00Z")).toBe("flightcheck-study-2026-08-08");
  });

  it("reads the stamp in UTC so the name matches the date on the page", () => {
    expect(studyExportFilename("2026-08-08T23:30:00Z")).toBe("flightcheck-study-2026-08-08");
  });

  it("falls back to today rather than putting NaN in a filename", () => {
    // The Content-Disposition header is built from this. "Invalid Date" in a
    // filename is the kind of thing that survives all the way to a customer's
    // downloads folder.
    const name = studyExportFilename("not a date");

    expect(name).toMatch(/^flightcheck-study-\d{4}-\d{2}-\d{2}$/);
    expect(name).not.toContain("NaN");
  });

  it("produces a filename safe for a Content-Disposition header", () => {
    // No quotes, no spaces, no separators — the header wraps it in quotes.
    expect(studyExportFilename("2026-08-08T12:00:00Z")).toMatch(/^[a-z0-9-]+$/);
  });
});
