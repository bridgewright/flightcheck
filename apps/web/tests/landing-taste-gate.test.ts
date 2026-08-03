import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HERO, TRIAL_MICROCOPY } from "@/components/landing/copy";

// The three F-21 landing rules that are measurable, kept as a gate rather than
// as a paragraph in a plan.
//
// All three were fixed once by hand in this pass, and all three are the kind
// that decay: a dash creeps back into a sentence, a hero subtext grows a clause
// at a time, an eyebrow gets added above one more section because it looked
// bare. v0.6 already demonstrated what happens to a landing rule that is
// written down but not executed by CI, which is why these are here.
//
// The scope is deliberately this track's files. A tree-wide version of the dash
// ban lives with the design-system gate and carries its own exemption list;
// this one has no exemptions because none of these files needs any.
//
// taste-skill 4.7 (layout discipline), 4.8 (visual assets), 9.F and 9.G.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const landingDir = join(webRoot, "components/landing");
const motionDir = join(webRoot, "components/motion");
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

const files = [
  "app/page.tsx",
  ...readdirSync(landingDir).map((name) => `components/landing/${name}`),
  ...readdirSync(motionDir).map((name) => `components/motion/${name}`),
];

const words = (line: string) => line.split(/\s+/).filter(Boolean).length;

describe("no dash pretends to be punctuation", () => {
  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s contains neither an em-dash nor an en-dash", (file) => {
    // Comments too, not only strings. A rule that stops at the string boundary
    // is a rule the next person copies the wrong side of, and the character has
    // no job in this codebase that a period, a comma, a colon, or a pair of
    // parentheses does not do better.
    const offenders = read(file)
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /[—–]/.test(line))
      .map(({ line, number }) => `${file}:${number}: ${line}`);
    expect(offenders).toEqual([]);
  });
});

describe("the hero is one moment", () => {
  it("says it in twenty words or fewer", () => {
    // The cap is the rule, and the reason for the rule is that a forty-word
    // subtext pushes the CTAs out of the first viewport at laptop heights.
    expect(words(HERO.body)).toBeLessThanOrEqual(20);
  });

  it("keeps the two phrases the product cannot be described without", () => {
    // A shorter subtext that saved its words by dropping these has cut the
    // wrong thing: they are the whole differentiation for a non-native
    // speaker, and every competitor's hero could carry what is left.
    expect(HERO.body).toContain("in English");
    expect(HERO.body).toContain("out loud");
  });

  it("carries three text elements, and no tiny tagline under the buttons", () => {
    const hero = read("components/landing/Hero.tsx");
    // A named ban (taste-skill 4.7). The microcopy is not deleted, it moves.
    expect(hero).toContain("microcopy={false}");
    expect(hero).not.toContain("TRIAL_MICROCOPY");
  });

  it("still offers the trial under every other call to action", () => {
    // The trade is first-viewport trial terms, not the trial terms. If this
    // stops being true the trade has quietly become a deletion.
    const cta = read("components/landing/CtaRow.tsx");
    expect(cta).toContain("TRIAL_MICROCOPY");
    expect(TRIAL_MICROCOPY).toContain("free");
  });

  it("shows a visual and asks the visitor for nothing", () => {
    const hero = read("components/landing/Hero.tsx");
    // Text plus a gradient is not a hero (taste-skill 4.8), so there is a
    // framed screen. And DECISIONS 030: what F-45 rolled back was a widget
    // demanding input before the page had made its argument. A frame is proof,
    // not a demand, and nothing here takes a keystroke.
    expect(hero).toContain("ScreenFrame");
    expect(hero).not.toMatch(/<(?:textarea|input|form|button)\b/);
  });
});

describe("the small uppercase labels are rationed", () => {
  it("holds the landing to one eyebrow per three sections", () => {
    // Mechanical, exactly as the rule is written: count the LABEL token where
    // it sits above a heading, count the sections, compare. An eyebrow above
    // every section is the single most recognisable AI-design tell, which is
    // why the cap is a third rather than a preference.
    const page = read("app/page.tsx");
    const sections = [...page.matchAll(/<Section\b/g)].length + 1; // the hero counts as one
    const eyebrows = readdirSync(landingDir)
      .filter((name) => name.endsWith(".tsx"))
      .reduce(
        (total, name) =>
          total + [...readFileSync(join(landingDir, name), "utf8").matchAll(/\bLABEL\b/g)].length,
        0,
      );
    expect(sections).toBeGreaterThan(1);
    expect(eyebrows).toBeLessThanOrEqual(Math.ceil(sections / 3));
  });

  it("numbers the steps with a numeral rather than a step label", () => {
    // "Step 1 / Step 2 / Step 3" is banned by name (taste-skill 9.F): the step
    // content is the label. The order is still the mechanic here, so it is
    // carried by a serif numeral instead of an uppercase eyebrow.
    const steps = read("components/landing/HowItWorks.tsx");
    expect(steps).not.toMatch(/\bStep \{?/);
    expect(steps).not.toMatch(/\bLABEL\b/);
    expect(steps).toContain("font-serif");
  });
});
