import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The F-21 design system, as a gate rather than as a document.
//
// v0.6 shipped a house rule that every web track consume lib/ui.ts tokens, and
// it held exactly as far as a test enforced it: components/landing had a scan
// and came out with zero raw colour literals, while app/ and the rest of
// components/ had none and accumulated ~600. The lesson is not "write the rule
// down more firmly", it is "the rule is whatever CI fails on".
//
// The values this file checks are measured, not invented. The reference the
// brief names is ode.com, and the ground, ink, label chip, control geometry,
// and root size were read off its computed styles. So the claims worth pinning
// are:
//
//   1. The tokens exist, in one file, and nothing else declares a colour.
//   2. Every ink clears WCAG AA on every ground it is allowed to sit on. Body
//      runs at about 13px, so every pairing is small text and none of them get
//      the 3:1 large-text allowance.
//   3. The scheme is light only, the scale is set once at the root, headings
//      are weight 400, controls are not full pills, and the pastel lives on a
//      chip rather than behind the type.
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
 * The scans below are about what a module emits, not what it explains. These
 * files name the patterns they forbid, and a comment saying "no `dark:`
 * variant" must not be the thing that fails the check for `dark:` variants.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const declaredCss = globals.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "),
);
const emitted = withoutComments(uiTokens);
const COLOURS = declaredColours(globals);

// Every ground a body string may sit on, including the pastel chips.
const GROUNDS = ["paper", "paper-sunk", "surface", "sky", "blush", "ready-wash", "alarm-wash"];
const INKS = ["ink", "ink-muted", "ink-faint", "ready", "alarm"];

describe("the design tokens exist where the system says they do", () => {
  it("declares every ground, ink, line, and semantic colour", () => {
    for (const token of [...GROUNDS, ...INKS, "hairline", "field"]) {
      expect(COLOURS[token], `--color-${token} is missing from globals.css`).toMatch(
        /^#[0-9A-F]{6}$/,
      );
    }
  });

  it("declares the two elevation tokens, warm-tinted rather than black", () => {
    const shadows = globals.match(/--shadow-(?:raise|float)\s*:[^;]+;/g) ?? [];
    expect(shadows.length).toBe(2);
    for (const decl of shadows) {
      // A pure-black shadow on a warm ground reads as dirt.
      expect(decl, `${decl} uses a black shadow`).not.toMatch(/rgb\(\s*0\s+0\s+0/);
    }
  });
});

describe("contrast, computed from the declared values", () => {
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
    // WCAG 1.4.11: a border that is the only thing identifying an input has to
    // clear 3:1. --color-hairline deliberately does not and is decorative
    // only; --color-field is the one that draws controls.
    for (const ground of ["paper", "paper-sunk", "surface"]) {
      const ratio = contrast(COLOURS.field, COLOURS[ground]);
      expect(
        ratio,
        `--color-field on --color-${ground} is ${ratio.toFixed(2)}:1, below 3`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the dark control and the focus ring legible", () => {
    expect(contrast(COLOURS.paper, COLOURS.ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(COLOURS.ink, COLOURS.paper)).toBeGreaterThanOrEqual(3);
  });
});

describe("the scheme and the scale", () => {
  it("is light only", () => {
    expect(declaredCss).toMatch(/color-scheme:\s*light/);
    expect(declaredCss).not.toMatch(/prefers-color-scheme:\s*dark/);
  });

  it("makes any surviving dark: utility inert rather than trusting the sweep", () => {
    // Tailwind's default dark variant keys off the reader's machine, so a
    // light palette alone does not stop a leftover `dark:` from repainting a
    // surface. Rebinding it to a class the product never sets means the
    // decision holds even mid-sweep, and holds again the next time someone
    // pastes a `dark:` utility in from another project.
    expect(declaredCss).toMatch(/@custom-variant\s+dark\s*\(/);
  });

  it("sets the root scale once, as a percentage", () => {
    // 87.5% is a 14px root, which is what the reference sets. This reverses an
    // earlier "110% is the new 100%" directive, on the user's decision of
    // 2026-08-04 after seeing the two side by side. A percentage rather than a
    // px value so it scales the reader's own browser text-size setting instead
    // of overriding it.
    expect(declaredCss).toMatch(/html\s*\{[^}]*font-size:\s*87\.5%/);
    // And nothing in the vocabulary compensates for it with a pixel literal.
    expect(emitted).not.toMatch(/text-\[\d/);
  });

  it("honours reduced motion at the stylesheet level, not only in components", () => {
    expect(declaredCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("keeps the landing readable when scripting is off", () => {
    // The entry motion ships its hidden state in the server HTML, so without
    // this rule a reader with JavaScript disabled gets a blank page whose text
    // is all present in the DOM.
    expect(declaredCss).toMatch(/@media\s*\(scripting:\s*none\)/);
    expect(declaredCss).toMatch(/\[data-reveal\]/);
  });
});

describe("the type stack", () => {
  it("loads Geist and its mono through next/font, and no serif", () => {
    expect(layout).toMatch(/from\s+"next\/font\/google"/);
    expect(layout).toContain("Geist");
    expect(layout).toContain("Geist_Mono");
    // A text serif carried display type for one day. The reference uses none,
    // so neither does this: not in the layout, not as a theme family, not as a
    // utility anywhere in the vocabulary.
    expect(withoutComments(layout)).not.toMatch(/Newsreader/);
    expect(declaredCss).not.toMatch(/--font-serif/);
    expect(emitted).not.toMatch(/\bfont-serif\b/);
  });

  it("gives every named step its own size and leading", () => {
    // A heading should be one class, not four, so a call site cannot get the
    // pairing wrong.
    for (const step of ["display", "verdict", "page", "section", "body", "fine", "action", "label"]) {
      expect(declaredCss, `--text-${step} is missing`).toContain(`--text-${step}:`);
      expect(declaredCss, `--text-${step} has no line-height`).toContain(
        `--text-${step}--line-height:`,
      );
    }
  });

  it("keeps every heading at weight 400", () => {
    // The reference builds hierarchy from size, space, and colour rather than
    // from boldness, and that is most of why it reads light. font-medium is
    // allowed only where a label sits directly beside body text at the same
    // size and nothing else would separate them.
    for (const step of ["display", "verdict", "page", "section"]) {
      expect(declaredCss, `--text-${step} is not weight 400`).toContain(
        `--text-${step}--font-weight: 400`,
      );
    }
    expect(emitted).not.toMatch(/\bfont-bold\b/);
    expect(emitted).not.toMatch(/\bfont-semibold\b/);
  });

  it("sets the small labels in mono, uppercase, with real tracking", () => {
    // The label chip is the reference's signature element: 9.6px mono
    // uppercase at 0.1em. Setting it in the body face at the same size reads
    // as small body text rather than as a label.
    expect(declaredCss).toMatch(/--text-label--letter-spacing:\s*0\.1em/);
    expect(declaredCss).toMatch(/--text-action--letter-spacing:\s*0\.1em/);
    const labelBlock = emitted.split("export const ").find((b) => b.startsWith("LABEL "));
    expect(labelBlock, "LABEL is missing").toBeDefined();
    expect(labelBlock).toContain("font-mono");
    expect(labelBlock).toContain("uppercase");
  });
});

describe("the shape rule", () => {
  it("gives controls their own radius, smaller than a full pill", () => {
    // A control is not a full pill. The reference's primary button is a 7px
    // rounded rectangle about 27px tall; only the small label chips are round.
    // Making every button a pill is a large part of why they read as thick.
    expect(declaredCss).toContain("--radius-control:");
    expect(declaredCss).toContain("--radius-surface:");
    for (const button of ["PRIMARY_BUTTON", "CTA_BUTTON", "SECONDARY_BUTTON", "DANGER_BUTTON"]) {
      const block = emitted.split("export const ").find((b) => b.startsWith(button));
      expect(block, `${button} is missing`).toBeDefined();
      expect(block, `${button} is a full pill`).not.toMatch(/rounded-full/);
      expect(block, `${button} does not use the control radius`).toContain("rounded-control");
    }
  });

  it("keeps the pastel on a chip rather than behind the type", () => {
    expect(emitted).toContain("bg-sky");
    expect(emitted).toContain("bg-blush");
    // The chips are the round things, and they are round in one place: every
    // chip composes the same shell, so the shape cannot drift between them.
    const shell = emitted.split(/(?:export )?const /).find((b) => b.startsWith("CHIP_SHELL"));
    expect(shell, "CHIP_SHELL is missing").toBeDefined();
    expect(shell).toContain("rounded-full");
    for (const chip of ["CHIP_SKY", "CHIP_BLUSH", "CHIP", "CHIP_READY"]) {
      const block = emitted.split("export const ").find((b) => b.startsWith(`${chip} `));
      expect(block, `${chip} is missing`).toBeDefined();
      expect(block, `${chip} does not compose the shared chip shell`).toContain("CHIP_SHELL");
    }
    expect(emitted).not.toContain("AMBIENT_WASH");
    expect(declaredCss).not.toMatch(/ambient-wash/);
  });

  it("draws the hero cloud from an asset, and uses no CSS gradient at all", () => {
    // The reference's cloud is an image, which is why scanning its computed
    // styles for a gradient found nothing and an earlier pass here concluded
    // it had no background field. Ours is an asset too, so the rule is the
    // strict one: zero gradients in the stylesheet. A gradient appearing here
    // later is the AI-gradient tell arriving, and it fails at CI.
    const gradients = declaredCss.match(/(?:radial|linear|conic)-gradient/g) ?? [];
    expect(gradients, "the stylesheet reached for a gradient").toEqual([]);
    expect(declaredCss).toMatch(/\.hero-bloom\s*\{/);
    expect(declaredCss).toMatch(/hero-bloom\.svg/);
    expect(emitted).toContain("HERO_BLOOM");

    // It must not be able to draw its own edges, and it must not follow the
    // reader down the page. Full-bleed and absolute: fixed was the first
    // attempt and it tinted every screen below the hero.
    const bloom = declaredCss.slice(declaredCss.indexOf(".hero-bloom"));
    const body = bloom.slice(0, bloom.indexOf("}"));
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).not.toMatch(/position:\s*fixed/);
    expect(body).toMatch(/pointer-events:\s*none/);
    // Negative horizontal insets would widen the document and put a horizontal
    // scrollbar on the landing page.
    expect(body).not.toMatch(/inset:[^;]*-\d/);
  });
});

describe("the token module is the only vocabulary", () => {
  it("uses no raw Tailwind colour utility", () => {
    const rawColour = emitted.match(
      /\b(?:text|bg|border|divide|ring|from|via|to|shadow|outline|decoration|accent|caret|fill|stroke)-(?:neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky-\d|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/,
    );
    expect(rawColour?.[0] ?? null).toBeNull();
  });

  it("carries no dark-mode variant", () => {
    expect(emitted).not.toMatch(/\bdark:/);
  });

  it("hard-codes no colour of its own", () => {
    // Values live in globals.css. A hex here is a value the contrast matrix
    // above cannot see.
    expect(emitted).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
