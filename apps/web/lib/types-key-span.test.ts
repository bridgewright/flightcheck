import { describe, expect, it } from "vitest";

import type { DimensionScore } from "./types";

// F-48: key_span is additive. Every report stored since v0.1 predates the
// field, so absence must behave exactly as today: the old shape typechecks
// unchanged (that compile IS the test) and renderers keep the positional
// first-sentence fallback (lib/rationale.ts).

const STORED: DimensionScore = {
  // Exactly the shape the worker serialized before F-48: no key_span,
  // empty strengths/weaknesses.
  dimension_key: "structured-answers",
  score: 3.5,
  evidence_quotes: ['"My recommendation was to cut it early."'],
  rationale: "Leads with a conclusion in two of three answers.",
  strengths: [],
  weaknesses: [],
};

describe("DimensionScore.key_span is additive", () => {
  it("an old-shape score, stored before the field existed, reads as absent", () => {
    expect(STORED.key_span).toBeUndefined();
  });

  it("carries the judge's marked span verbatim when present", () => {
    // The contract: a verbatim substring of `rationale`, character for
    // character, never a paraphrase.
    const scored: DimensionScore = {
      ...STORED,
      key_span: "Leads with a conclusion in two of three answers.",
    };
    expect(scored.key_span).toBe(
      "Leads with a conclusion in two of three answers.",
    );
    expect(scored.rationale).toContain(scored.key_span ?? "");
  });
});
