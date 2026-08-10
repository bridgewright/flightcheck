import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-88: the landing's pink hero cloud drifts a little with scroll. The leaf
// (components/motion/Drift.tsx) already passes every directory-wide scan in
// tests/landing-motion.test.ts: client boundary, presentational props only,
// reduced-motion branch without a motion component, transform and opacity
// only, data-reveal carried. This file holds what those scans cannot see:
// that the hero actually consumes the leaf, and that the leaf's motion is
// wholly the tested pure function in components/motion/scroll.ts. Pins count
// identifier mentions (the b5-t3 lesson: a naive grep pin dies to one alias).

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

/** Source with comments blanked, line count preserved: the house idiom. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const hero = withoutComments(read("components/landing/Hero.tsx"));
const drift = withoutComments(read("components/motion/Drift.tsx"));

describe("the hero's cloud is the drift leaf", () => {
  it("mounts Drift exactly once, wearing the bloom", () => {
    // Three mentions: the import identifier, the module specifier (the file
    // is named Drift.tsx, so the path carries the word), and the one
    // element. An alias, a re-export, or a second cloud all change this
    // number.
    const mentions = hero.match(/\bDrift\b/g) ?? [];
    expect(mentions.length, "Drift is aliased, re-exported, or mounted again").toBe(3);
    expect(hero).toContain('from "@/components/motion/Drift"');
    expect(hero).toContain("<Drift className={HERO_BLOOM} />");
  });

  it("hands the leaf the bloom token and keeps no bloom of its own", () => {
    // HERO_BLOOM: the import and the one hand-off. A third mention is a
    // second element carrying the cloud class outside the drift.
    const mentions = hero.match(/\bHERO_BLOOM\b/g) ?? [];
    expect(mentions.length, "HERO_BLOOM is consumed outside the Drift leaf").toBe(2);
    // The static div the leaf replaced owned the hero's only aria-hidden;
    // the leaf carries it now, so a reappearance here is a second cloud.
    expect(hero).not.toContain("aria-hidden");
  });
});

describe("the drift leaf's motion is entirely the tested budget", () => {
  it("maps scroll to transform through driftY and through nothing else", () => {
    // Two mentions: the import and the one useTransform argument.
    const mentions = drift.match(/\bdriftY\b/g) ?? [];
    expect(mentions.length, "driftY is aliased, wrapped, or called again").toBe(2);
    expect(drift).toContain('from "./scroll"');
    expect(drift).toContain("useTransform(scrollY, driftY)");
  });

  it("reads the page scroll once, rAF-batched and passive, via motion", () => {
    const scrolls = drift.match(/\buseScroll\b/g) ?? [];
    expect(scrolls.length, "useScroll is aliased or called again").toBe(2);
    const transforms = drift.match(/\buseTransform\b/g) ?? [];
    expect(transforms.length, "useTransform is aliased or called again").toBe(2);
    // No hand-rolled listener: motion owns the subscription lifecycle, so
    // nothing here can forget passive, the rAF batch, or the removal.
    expect(drift).not.toMatch(/addEventListener|requestAnimationFrame/);
  });

  it("moves the compositor transform and nothing else", () => {
    // One style key, the motion value. A second key is a value the budget
    // does not govern; writing y through style keeps every frame off the
    // React render path, which is what zero layout thrash means here.
    expect(drift).toContain("style={{ y }}");
    expect(drift).not.toMatch(/opacity|scale|rotate/);
  });

  it("declares not a single number of its own", () => {
    // Every magnitude lives in components/motion/scroll.ts, where it is
    // unit-tested. A digit here is a second copy of the budget.
    expect(drift).not.toMatch(/\d/);
  });
});
