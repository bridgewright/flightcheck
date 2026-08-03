import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The F-21 design system, as a gate rather than as a document.
//
// v0.6 shipped a house rule that every web track consume lib/ui.ts tokens, and
// it held exactly as far as a test enforced it: components/landing/ had a
// scan and came out with zero raw colour literals, while app/ and the rest of
// components/ had none and accumulated ~600. The lesson is not "write the rule
// down more firmly", it is "the rule is whatever CI fails on".
//
// So the three claims this pass makes about itself are checked here:
//
//   1. The tokens exist, in one file, and nothing else declares a colour.
//   2. Every text token clears WCAG AA on every ground it is allowed to sit
//      on, and every control boundary clears 3:1. This is the claim that is
//      easiest to make in a spec table and hardest to keep through a hundred
//      later edits, so it is computed from the actual declared values.
//   3. The scheme is light only (user decision D1) and the scale-up is a root
//      change rather than per-screen tweaks.
//
// spec: plans/2026-08-03-f21-design-spec.md (private workspace)

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const globals = readFileSync(join(webRoot, "app/globals.css"), "utf8");
const uiTokens = readFileSync(join(webRoot, "lib/ui.ts"), "utf8");
const layout = readFileSync(join(webRoot, "app/layout.tsx"), "utf8");

/** Every `--color-*` declaration in globals.css, as name → hex. */
function declaredColours(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[match[1]] = match[2].toUpperCase();
  }
  return out;
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Source with comments blanked out, line count preserved.
 *
 * The scans below are about what the module emits, not what it explains. This
 * file's own header names the patterns it forbids, and a comment that says
 * "no `dark:` variant" must not be the thing that fails the check for `dark:`
 * variants.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

// globals.css with its CSS comments blanked out. Same reason as above: the
// file explains at length why there is no dark block, and that explanation
// must not be the thing that fails the "there is no dark block" check.
const declaredCss = globals.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "),
);

const COLOURS = declaredColours(globals);

const GROUNDS = ["paper", "paper-sunk", "surface", "accent-wash", "ready-wash", "alarm-wash"];
const INKS = ["ink", "ink-muted", "ink-faint", "accent", "ready", "alarm"];

describe("the design tokens exist where the system says they do", () => {
  it("declares every ground, ink, line, and semantic colour", () => {
    for (const token of [...GROUNDS, ...INKS, "hairline", "field"]) {
      expect(COLOURS[token], `--color-${token} is missing from globals.css`).toMatch(
        /^#[0-9A-F]{6}$/,
      );
    }
  });

  it("declares the two elevation tokens, warm-tinted rather than black", () => {
    for (const shadow of ["--shadow-raise", "--shadow-float"]) {
      expect(globals, `${shadow} is missing`).toContain(shadow);
    }
    // A pure-black shadow on a warm ground reads as dirt. Every shadow colour
    // in the file carries the ink hue instead.
    const shadowBlock = globals.match(/--shadow-(?:raise|float)\s*:[^;]+;/g) ?? [];
    expect(shadowBlock.length).toBe(2);
    for (const decl of shadowBlock) {
      expect(decl, `${decl} uses a black shadow`).not.toMatch(/rgb\(\s*0\s+0\s+0/);
    }
  });
});

describe("contrast, computed from the declared values", () => {
  // Body text needs 4.5:1. Every ink token is allowed on every ground, so the
  // matrix is checked in full rather than at the pairs someone remembered.
  it.each(INKS)("%s clears AA on every ground", (ink) => {
    for (const ground of GROUNDS) {
      const ratio = contrast(COLOURS[ink], COLOURS[ground]);
      expect(
        ratio,
        `--color-${ink} on --color-${ground} is ${ratio.toFixed(2)}:1, below AA 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives control boundaries the 3:1 they need to be seen", () => {
    // WCAG 1.4.11: a border that is the only thing identifying an input has
    // to clear 3:1. --color-hairline deliberately does not and is therefore
    // decorative only; --color-field is the one that draws controls.
    for (const ground of ["paper", "paper-sunk", "surface"]) {
      const ratio = contrast(COLOURS.field, COLOURS[ground]);
      expect(
        ratio,
        `--color-field on --color-${ground} is ${ratio.toFixed(2)}:1, below 3`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the dark pill CTA legible in both directions", () => {
    expect(contrast(COLOURS.paper, COLOURS.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring visible against the page", () => {
    // One focus treatment for the whole product, inherited from v0.2. It only
    // works if the ring colour still separates from the ground.
    expect(contrast(COLOURS.ink, COLOURS.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe("the scheme and the scale", () => {
  it("is light only", () => {
    // Decision D1. Dark mode is not half-supported: there is no dark block to
    // drift out of sync, and no `dark:` variant anywhere to maintain. Adding
    // it later is one @media block against these same variables.
    expect(declaredCss).toMatch(/color-scheme:\s*light/);
    expect(declaredCss).not.toMatch(/prefers-color-scheme:\s*dark/);
  });

  it("makes any surviving dark: utility inert rather than trusting the sweep", () => {
    // Tailwind v4's default dark variant keys off the reader's machine, so a
    // light palette alone does not stop a leftover `dark:` from repainting a
    // surface. Rebinding the variant to a class the product never sets means
    // the light-only decision holds even mid-sweep, and holds again the next
    // time someone pastes a `dark:` utility in from another project.
    expect(declaredCss).toMatch(/@custom-variant\s+dark\s*\(/);
  });

  it("scales up at the root, not per screen", () => {
    // "What 110% browser zoom shows today should be the new 100%". A
    // percentage rather than a px value, so it multiplies the reader's own
    // browser text-size setting instead of overriding it.
    expect(declaredCss).toMatch(/html\s*\{[^}]*font-size:\s*110%/);
  });

  it("honours reduced motion at the stylesheet level, not only in components", () => {
    // The motion layer degrades in React via useReducedMotion, but a CSS
    // backstop catches transitions that never pass through a component.
    expect(declaredCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe("the token module is the only vocabulary", () => {
  const emitted = withoutComments(uiTokens);

  it("uses no raw Tailwind colour utility", () => {
    const rawColour = emitted.match(
      /\b(?:text|bg|border|divide|ring|from|via|to|shadow|outline|decoration|accent|caret|fill|stroke)-(?:neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/,
    );
    expect(rawColour?.[0] ?? null).toBeNull();
  });

  it("carries no dark-mode variant", () => {
    expect(emitted).not.toMatch(/\bdark:/);
  });

  it("hard-codes no colour of its own", () => {
    // Values live in globals.css. A hex here is a value that the contrast
    // matrix above cannot see.
    expect(emitted).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("the display face is loaded the way Next serves fonts", () => {
  it("loads the serif through next/font rather than a stylesheet link", () => {
    expect(layout).toMatch(/from\s+"next\/font\/google"/);
    expect(layout).toContain("Newsreader");
    // The font variable has to reach the document, not just be constructed.
    expect(layout).toMatch(/newsreader\.variable/);
  });

  it("exposes the serif as a theme family so utilities can reach it", () => {
    expect(globals).toMatch(/--font-serif:\s*var\(--font-newsreader\)/);
  });

  it("still loads Geist for UI, body, and data", () => {
    expect(layout).toContain("Geist");
    expect(globals).toContain("--font-geist-sans");
  });
});
