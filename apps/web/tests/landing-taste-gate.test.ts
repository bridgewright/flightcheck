import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STEP_NUMERAL } from "@/lib/ui";

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
// The scope here is this track's files, and it is stricter than the tree-wide
// rule rather than a subset of it: these files may not carry the character in
// their comments either, because they are where a stranger's first impression
// is assembled and where a dash reappears first.
//
// An earlier version of this header said a tree-wide dash ban "lives with the
// design-system gate". It did not exist, and about a hundred rewritten strings
// went ungated behind that sentence. It exists now, in
// `tests/token-vocabulary.test.ts`, over strings and JSX text across `app/`,
// `components/` and `lib/`, with a two-entry exemption list.
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

/** Source with comments blanked out. A file that documents the pattern it is
 * forbidden to contain must not fail on its own documentation, and this gate
 * did exactly that on its first run. */
const emitted = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );

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

  it("carries the claim alone, and asks the visitor for nothing", () => {
    const hero = read("components/landing/Hero.tsx");

    // Two things have now been put beside the claim and both came back out.
    // F-45 was an interactive rubric preview, rolled back the same day
    // (DECISIONS 030). A framed screenshot replaced it, argued for on
    // taste-skill 4.8's "text plus a gradient is not a hero", and the user
    // removed that too. So the rule is the user's rather than the skill's:
    // the hero is words, a control, and the cloud behind them.
    //
    // This assertion is the thing that stops a third one appearing. It is
    // deliberately about the shape of the hero, not about one component name.
    expect(hero).not.toContain("ScreenFrame");
    // Every way of putting a picture there, not just the two that were used.
    // An inline <svg> and a CSS background both cleared the earlier version of
    // this check, which named `img` and a grid column and nothing else.
    expect(hero).not.toMatch(/\bimg\b|<Image\b|<svg\b|<video\b|<canvas\b|<picture\b/);
    expect(hero).not.toMatch(/bg-\[url\(|backgroundImage/);
    // No side-by-side split: a second column is where the last two arrived.
    // Flex is the other way to build one, and it was open until now.
    expect(hero).not.toMatch(/\bgrid-cols-\d|\bcol-span-\d/);
    expect(hero).not.toMatch(/\bflex-row\b|\bmd:flex-row\b|\blg:flex-row\b/);

    // And still nothing that takes a keystroke, which is the DECISIONS 030
    // half and the half that has never changed.
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
    // carried by a numeral in a faint chip.
    //
    // This assertion was bypassable twice over and the Phase 4 review proved
    // it: `/\bStep \{?/` is case-sensitive, so the literally banned string
    // "STEP 1" slipped past, and `/\bLABEL\b/` matched only the token NAME,
    // so inlining the token's class string evaded both this check and the
    // eyebrow cap that counts the same word. The re-point that replaced a
    // serif check with `not.toMatch(/uppercase/)` was worse than inert:
    // uppercase on a rendered digit has no visual effect at all.
    //
    // So the checks below are about what a reader would see: no step word in
    // any casing, and no uppercase micro-label above the steps however it is
    // spelled, whether through the token or by hand.
    const source = read("components/landing/HowItWorks.tsx");
    // The token's own identifier is not a step label, so it is taken out
    // before the word is looked for.
    const steps = emitted(source).replace(/STEP_NUMERAL/g, "");
    expect(steps).not.toMatch(/\bstep\s*\{?\s*\d|\bstep\s+\{index/i);
    expect(steps).not.toMatch(/\bLABEL\b/);
    // The inlined form of the same thing. LABEL is mono + uppercase + the
    // label size; any two of those together above a step is the eyebrow
    // returning under another name.
    expect(steps).not.toMatch(/uppercase[^"'`]*text-label|text-label[^"'`]*uppercase/);

    // And the numeral is still a numeral, from the token, at a size the
    // reader can tell from a heading.
    expect(source).toContain("STEP_NUMERAL");
    expect(STEP_NUMERAL).toContain("font-mono");
    expect(STEP_NUMERAL).toContain("text-label");
  });
});
