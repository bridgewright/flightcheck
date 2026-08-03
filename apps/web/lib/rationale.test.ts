import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { splitRationale } from "./rationale";

// The split decides what the report emphasises, so the cases that matter are
// the ones where a naive sentence split would emphasise the wrong thing: a
// rationale that quotes the candidate mid-sentence, an abbreviation, a single
// sentence with nothing to split.

describe("splitRationale", () => {
  it("takes the first sentence as the finding and the rest as its support", () => {
    const { lead, rest } = splitRationale(
      "The candidate structures the problem well. They then validate it with data. A pilot follows.",
    );
    expect(lead).toBe("The candidate structures the problem well.");
    expect(rest).toBe("They then validate it with data. A pilot follows.");
  });

  it("does not split inside a quotation the judge embedded", () => {
    // Judges quote the candidate mid-sentence constantly: the sample report
    // carries fourteen quoted spans in one paragraph. A split at the full stop
    // inside a quote would cut the finding in half.
    const { lead } = splitRationale(
      'They describe how they would "map the whole process." and then act on it. Support follows here.',
    );
    expect(lead).toContain("map the whole process");
    expect(lead).toContain("act on it.");
  });

  it("does not split at an abbreviation", () => {
    const { lead } = splitRationale(
      "They cite metrics, e.g. call duration, as the outcome. The reasoning follows.",
    );
    expect(lead).toBe("They cite metrics, e.g. call duration, as the outcome.");
  });

  it("emphasises nothing when there is only one sentence", () => {
    const { lead, rest } = splitRationale("A single sentence carries the whole judgment.");
    expect(lead).toBe("A single sentence carries the whole judgment.");
    expect(rest).toBe("");
  });

  it("refuses to split when the lead would swallow the paragraph", () => {
    // Emphasising nearly everything emphasises nothing, and costs the reader
    // the contrast the split exists for. One plain block is the better failure.
    const long = `${"word ".repeat(60)}sentence ends here. Short tail.`;
    const { rest } = splitRationale(long);
    expect(rest).toBe("");
  });

  it("trims without dropping content", () => {
    const input = "  Finding here. Support here.  ";
    const { lead, rest } = splitRationale(input);
    expect(`${lead} ${rest}`).toBe(input.trim());
  });
});

describe("the fixture every visitor reads", () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL("../public/sample-report.json", import.meta.url)), "utf8"),
  ) as { report: { dimension_scores: { rationale: string }[] } };

  it("splits every dimension into a finding and its support", () => {
    // The premise the whole treatment rests on: these paragraphs open with the
    // judgment. Checked against the real fixture rather than assumed, because
    // if a rationale ever stops opening that way, the report would be
    // emphasising an arbitrary first clause.
    const scores = fixture.report.dimension_scores;
    expect(scores.length).toBeGreaterThan(0);
    for (const { rationale } of scores) {
      const { lead, rest } = splitRationale(rationale);
      expect(rest, "a long rationale collapsed to a single block").not.toBe("");
      // A finding is a sentence, not a fragment and not a paragraph.
      expect(lead.length).toBeGreaterThan(40);
      expect(lead.length).toBeLessThan(320);
      expect(lead).toMatch(/[.!?]["'”’]?$/);
    }
  });
});
