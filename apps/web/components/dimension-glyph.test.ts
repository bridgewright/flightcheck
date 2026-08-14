import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CHANNEL_GLYPHS, GLYPH_PATHS, dimensionGlyph } from "@/components/dimension-glyph";
import type { Channel } from "@/lib/types";
import sampleReport from "@/public/sample-report.json";

// The mapping is tested over the two committed real corpora (DECISIONS 071):
// the rubric the product actually compiled for a real JD, and the sample
// report the landing links to. Every known dimension must land a
// non-fallback glyph; the fallback rate over this corpus is the number the
// decision's revisit condition watches.

const realRubric = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../evals/suites/rubric_discrimination/rubric.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
) as { dimensions: { key: string; name: string; channel: Channel }[] };

const CORPUS: { key: string; name: string; channel: Channel }[] = [
  ...realRubric.dimensions,
  ...sampleReport.dimensions.map((dimension) => ({
    key: dimension.key,
    name: dimension.name,
    channel: dimension.channel as Channel,
  })),
];

describe("dimensionGlyph over the committed corpus", () => {
  it.each(CORPUS.map((d) => [d.key, d] as const))(
    "%s lands a non-fallback glyph",
    (_key, dimension) => {
      const chosen = dimensionGlyph(dimension.key, dimension.name, dimension.channel);
      expect(chosen.fallback).toBe(false);
      expect(GLYPH_PATHS[chosen.glyph]).toBeDefined();
    },
  );

  it("has a corpus fallback rate of zero", () => {
    const fallbacks = CORPUS.filter(
      (d) => dimensionGlyph(d.key, d.name, d.channel).fallback,
    );
    expect(fallbacks).toEqual([]);
  });

  it("keeps content and delivery visually apart on the corpus", () => {
    // Six content dimensions must not all collapse onto one glyph, and no
    // content dimension may take the delivery channel's waveform.
    const content = new Set(
      CORPUS.filter((d) => d.channel === "content").map(
        (d) => dimensionGlyph(d.key, d.name, d.channel).glyph,
      ),
    );
    expect(content.size).toBeGreaterThan(3);
    expect(content.has(CHANNEL_GLYPHS.delivery)).toBe(false);
  });
});

describe("dimensionGlyph fallback", () => {
  it("degrades an unmatched name to its channel glyph, never to a blank", () => {
    expect(dimensionGlyph("quantum-basket-weaving", "Quantum Basket Weaving", "content")).toEqual({
      glyph: CHANNEL_GLYPHS.content,
      fallback: true,
    });
    expect(dimensionGlyph("quantum-basket-weaving", "Quantum Basket Weaving", "delivery")).toEqual({
      glyph: CHANNEL_GLYPHS.delivery,
      fallback: true,
    });
  });

  it("still lands a glyph when the rubric fetch failed and channel is null", () => {
    const chosen = dimensionGlyph("quantum-basket-weaving", "Quantum Basket Weaving", null);
    expect(GLYPH_PATHS[chosen.glyph]).toBeDefined();
    expect(chosen.fallback).toBe(true);
  });

  it("gates on the channel, not only on the keyword", () => {
    // The corpus cannot prove this one. No committed content dimension happens
    // to carry a delivery word and no committed delivery dimension carries a
    // content word, so deleting either channel filter leaves every corpus
    // assertion above green. A compiled rubric is open-ended and "clarity" is
    // an ordinary content word, so the gate is pinned on names that cross.
    expect(
      dimensionGlyph("narrative-clarity", "Narrative Clarity", "content").glyph,
    ).not.toBe(CHANNEL_GLYPHS.delivery);
    expect(
      dimensionGlyph("stakeholder-presence", "Stakeholder Presence", "delivery").glyph,
    ).toBe(CHANNEL_GLYPHS.delivery);
  });

  it("matches keywords case-insensitively over key and name together", () => {
    // The key alone says nothing here; the name carries the keyword.
    expect(dimensionGlyph("dim-07", "STAKEHOLDER Alignment", "content").fallback).toBe(false);
    // And the name alone says nothing here; the key carries it.
    expect(dimensionGlyph("customer-discovery", "Dimension Seven", "content").fallback).toBe(false);
  });
});

describe("the glyph set itself", () => {
  it("is a fixed, hand-authored set of roughly eight to twelve", () => {
    const names = Object.keys(GLYPH_PATHS);
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names.length).toBeLessThanOrEqual(12);
  });

  it("draws every glyph as non-empty path data", () => {
    for (const [name, paths] of Object.entries(GLYPH_PATHS)) {
      expect(paths.length, `${name} draws nothing`).toBeGreaterThan(0);
      for (const d of paths) {
        expect(d, `${name} has a malformed path`).toMatch(/^[Mm]/);
      }
    }
  });

  it("names a real glyph for each channel fallback", () => {
    expect(GLYPH_PATHS[CHANNEL_GLYPHS.content]).toBeDefined();
    expect(GLYPH_PATHS[CHANNEL_GLYPHS.delivery]).toBeDefined();
  });
});
