import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emphasiseRationale, splitRationale } from "./rationale";

// F-48. The judge now marks its own finding (key_span, a verbatim substring of
// the rationale), and the emphasis follows the judge instead of the paragraph's
// position. The positional rule survives as the fallback because every report
// stored before the field existed lacks it, and the web must not crash on a
// report written by any past or future scorer: a span the rationale does not
// contain falls back, it never throws.

const RATIONALE =
  "The candidate structures the answer around a measurable outcome. The setup names the stakeholder before the action. The close returns to the number.";

describe("emphasiseRationale with the judge's span", () => {
  it("splits the rationale around the span, in place", () => {
    const parts = emphasiseRationale(RATIONALE, "names the stakeholder");
    expect(parts.source).toBe("key_span");
    expect(parts.span).toBe("names the stakeholder");
    expect(parts.before).toBe(
      "The candidate structures the answer around a measurable outcome. The setup ",
    );
    expect(parts.after).toBe(" before the action. The close returns to the number.");
  });

  it("reassembles the rationale exactly, so no renderer can drop a character", () => {
    const parts = emphasiseRationale(RATIONALE, "The setup names the stakeholder");
    expect(parts.before + parts.span + parts.after).toBe(RATIONALE);
  });

  it("has an empty before when the span opens the rationale", () => {
    const parts = emphasiseRationale(RATIONALE, "The candidate structures");
    expect(parts.source).toBe("key_span");
    expect(parts.before).toBe("");
  });

  it("splits at the first occurrence when the span repeats", () => {
    const parts = emphasiseRationale("The number leads. The number closes.", "The number");
    expect(parts.before).toBe("");
    expect(parts.after).toBe(" leads. The number closes.");
  });

  it("sheds surrounding whitespace a sloppy judge left on the span", () => {
    const parts = emphasiseRationale(RATIONALE, "  names the stakeholder  ");
    expect(parts.source).toBe("key_span");
    expect(parts.span).toBe("names the stakeholder");
  });
});

describe("emphasiseRationale falls back to the first-sentence rule", () => {
  const fallback = (keySpan: string | null | undefined) => {
    const parts = emphasiseRationale(RATIONALE, keySpan);
    const { lead, rest } = splitRationale(RATIONALE);
    expect(parts.source).toBe("first_sentence");
    expect(parts).toEqual({ before: "", span: lead, after: rest, source: "first_sentence" });
  };

  it("when the field is absent (every report stored before F-48)", () => {
    fallback(undefined);
  });

  it("when the field is null (a scorer round-trip serializes null)", () => {
    fallback(null);
  });

  it("when the field is an empty string", () => {
    fallback("");
  });

  it("when the field is only whitespace", () => {
    fallback("   ");
  });

  it("when the span is not a substring of the rationale, without throwing", () => {
    // The scorer pipeline enforces the verbatim-substring contract; the web
    // does not get to crash a paying customer's report over a violation of it.
    fallback("a paraphrase the judge never wrote");
  });
});

describe("the fixture every visitor reads, through the new entry point", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../public/sample-report.json", import.meta.url)), "utf8"),
  ) as { report: { dimension_scores: { rationale: string }[] } };

  it("agrees with splitRationale on every stored dimension", () => {
    // The sample report predates key_span. The new entry point must be a
    // strict superset: absent span in, exactly the positional split out.
    for (const { rationale } of fixture.report.dimension_scores) {
      const parts = emphasiseRationale(rationale, undefined);
      const { lead, rest } = splitRationale(rationale);
      expect(parts.span).toBe(lead);
      expect(parts.after).toBe(rest);
      expect(parts.before).toBe("");
    }
  });
});
