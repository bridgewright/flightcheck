import { describe, expect, it } from "vitest";

import type { RubricDimension } from "./types";

import { probingLabel } from "./rubric-format";

// F-94: probing_mode is additive. Every rubric stored before the field
// existed lacks it, so absence must behave exactly as today: the old shape
// typechecks unchanged (that compile IS the test) and renderers say nothing,
// which is what "direct" has always looked like.

const STORED: RubricDimension = {
  // Exactly the shape the compiler serialized before F-94: no probing_mode.
  key: "ai-safety",
  name: "AI Safety and Mission Alignment",
  weight: 0.1,
  channel: "content",
  anchors: [{ score: 5, behavior: "Names guardrails they actually shipped." }],
  signals: ["Weighs failure modes without being prompted."],
  citations: [],
};

describe("RubricDimension.probing_mode is additive", () => {
  it("an old-shape dimension, stored before the field existed, reads as absent", () => {
    expect(STORED.probing_mode).toBeUndefined();
  });

  it("typechecks with each valid value", () => {
    const direct: RubricDimension = { ...STORED, probing_mode: "direct" };
    const indirect: RubricDimension = { ...STORED, probing_mode: "indirect" };
    expect(direct.probing_mode).toBe("direct");
    expect(indirect.probing_mode).toBe("indirect");
  });
});

describe("probingLabel treats absence as direct", () => {
  it("says nothing for a dimension stored before the field existed", () => {
    // Legacy rubrics must render byte-identical to today, so the label
    // decision collapses absence and "direct" to the same silence.
    expect(probingLabel(STORED)).toBeNull();
  });

  it("says nothing for an explicitly direct dimension", () => {
    expect(probingLabel({ ...STORED, probing_mode: "direct" })).toBeNull();
  });

  it("names the indirect posture, claiming exactly the planner's guarantee", () => {
    // The planner never mints this dimension its own question, never opens
    // with it, never aims the focus or the pressure probe at it; the judge
    // reads it from the candidate's answers. The label claims that and no
    // more: it does NOT say the area never comes up, because a follow-up
    // inside another question's thread legitimately may touch it.
    expect(probingLabel({ ...STORED, probing_mode: "indirect" })).toBe(
      "Assessed from your answers, not asked as its own question",
    );
  });
});
