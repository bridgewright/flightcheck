import { describe, expect, it } from "vitest";

import type { RubricDimension } from "./types";

// F-62: jd_evidence is additive. Every rubric stored since v0.1 predates the
// field, so absence must behave exactly as today: the old shape typechecks
// unchanged (that compile IS the test) and renderers show no receipt.

const STORED: RubricDimension = {
  // Exactly the shape the compiler serialized before F-62: no jd_evidence.
  key: "structured-answers",
  name: "Structured thinking",
  weight: 0.25,
  channel: "content",
  anchors: [{ score: 5, behavior: "Leads with the recommendation." }],
  signals: ["Answers open with the conclusion."],
  citations: [],
};

describe("RubricDimension.jd_evidence is additive", () => {
  it("an old-shape dimension, stored before the field existed, reads as absent", () => {
    expect(STORED.jd_evidence).toBeUndefined();
  });

  it("carries the JD's verbatim words when present", () => {
    // The contract: a character-for-character substring of the job
    // description the compiler saw, enforced on the scorer side, never a
    // paraphrase.
    const compiled: RubricDimension = {
      ...STORED,
      jd_evidence: "own the deployment roadmap end to end",
    };
    expect(compiled.jd_evidence).toBe("own the deployment roadmap end to end");
  });

  it("round-trips null, the compiler's explicit no-receipt value", () => {
    const compiled: RubricDimension = { ...STORED, jd_evidence: null };
    expect(compiled.jd_evidence).toBeNull();
  });
});
