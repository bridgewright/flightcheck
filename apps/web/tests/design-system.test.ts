import { readdirSync, readFileSync, statSync } from "node:fs";
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
// The values this file checks are measured, not invented: the ground, ink,
// label chip, control geometry, and root size were read off the computed
// styles of the design reference the spec names. So the claims worth pinning
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
// The values are the design reference's measured computed styles (DECISIONS 035).

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

/** Every screen source, for the checks that have to look at the whole tree
 * rather than at the token module. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(webRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(webRoot, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(rel);
  }
  return out;
}
const FILES = [...walk("app"), ...walk("components"), ...walk("lib")].filter(
  (f) => !/\.test\.tsx?$/.test(f),
);

/**
 * The hero cloud, composited over paper at its strongest stop.
 *
 * This is a ground, and until now no gate knew it. The declared-value matrix
 * sees only flat tokens, so everything sitting over the bloom — the hero
 * claim, its subtext, both CTAs and their borders — was measured against paper
 * it is not actually on. A Round 2 reviewer sampled the real painted pixels
 * under the landing's one link and read 2.98 to 3.01:1 across twelve
 * viewports, which is the 3:1 bar landing on the coin.
 *
 * The opacity is READ FROM THE SVG rather than written here, because the two
 * have drifted before: the stylesheet described the strongest stop as 40% when
 * it was 95%. If someone deepens the cloud, this ground darkens with it and
 * the matrix below fails, which is the property that was missing.
 */
const bloomSvg = readFileSync(join(webRoot, "public/hero-bloom.svg"), "utf8");
const bloomPeak = Math.max(
  ...[...bloomSvg.matchAll(/stop-opacity="([\d.]+)"/g)].map((m) => Number(m[1])),
);

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

  it("declares one elevation token, warm-tinted rather than black", () => {
    // One, not two. A `- -shadow-raise` was declared here for "cards that
    // genuinely lift" and nothing in the product ever lifted: every grouping
    // resolved to whitespace, a hairline, or a ground change, which is the
    // order the stylesheet states. It and its `CARD_RAISED` token were removed
    // rather than left standing as an offer no screen took up.
    //
    // What remains is the account menu, which floats over the page rather than
    // sitting in it, and is the only thing that does.
    const shadows = globals.match(/--shadow-[a-z-]+\s*:[^;]+;/g) ?? [];
    expect(shadows.length, "an elevation token came back").toBe(1);
    // A pure-black shadow on a warm ground reads as dirt. Every spelling of
    // it, not just the space-separated rgb() the token happened to use:
    // `rgba(0, 0, 0, .05)` passed the version of this line that shipped.
    for (const black of [
      /rgba?\(\s*0\s*[,\s]\s*0\s*[,\s]\s*0\s*[,)]/,
      /#000\b|#000000\b/i,
      /\bblack\b/i,
      /hsla?\(\s*0[^)]*?\b0%\s*[,)]/,
      /oklch\(\s*0[\s,]/,
    ]) {
      expect(shadows[0], `${shadows[0]} uses a black shadow`).not.toMatch(black);
    }
    // And it has to still be reachable from the token module.
    expect(emitted, "nothing consumes the float shadow").toContain("shadow-float");
  });
});

/**
 * Every opacity modifier in the tree, with the ground it renders over.
 *
 * The matrix below reads the declared values, which is why it could not see
 * these: `text-ink/60` is not a declared colour, it is one composited at paint
 * time, and Phase 4 found two of them under the bar in twelve render sites, a
 * secondary control label at 3.73:1 and that control's border at 1.99:1, which
 * was the only thing marking it as a control at rest.
 *
 * A row declares WHAT THE UTILITY IS, not what bar it would like. That is the
 * difference from the version this replaces, which carried a free
 * `bar: number | null`: a reviewer added a `text-ink/45` row with `bar: null`
 * and a plausible note, and a control label at 2.52:1 passed. Worse, every row
 * was `bar: null`, so the test named "computes every opacity modifier"
 * computed none of them. Null was the path of least resistance at exactly the
 * moment CI was telling someone off.
 *
 * So the bar comes from the kind, the kind is checked against the utility's
 * own prefix, and `ground` — the only kind with no bar — is available solely
 * to `bg-*`. A mark cannot be declared a background.
 */
const BARS = {
  /** Small text, which is every body size in this product. */
  text: 4.5,
  /** A boundary that identifies a control. WCAG 1.4.11. */
  boundary: 3,
  /** A fill. It carries no information itself; whatever sits ON it is checked
   *  as text against this composited value. */
  ground: null,
} as const;

/** Which prefixes may legitimately claim each kind. */
const KIND_PREFIXES: Record<keyof typeof BARS, RegExp> = {
  text: /^(?:[a-z-]+:)*(?:text|placeholder|decoration|fill)-/,
  boundary: /^(?:[a-z-]+:)*(?:border|outline|ring|divide|stroke)(?:-[trblxy])?-/,
  ground: /^(?:[a-z-]+:)*bg-/,
};

const COMPOSITES: {
  utility: string;
  ink: string;
  alpha: number;
  ground: string;
  kind: keyof typeof BARS;
  note: string;
}[] = [
  {
    utility: "bg-ink/6",
    ink: "ink",
    alpha: 0.06,
    ground: "paper",
    kind: "ground",
    note: "the tint behind a step numeral, whose own ink is checked as text",
  },
  {
    utility: "bg-paper/95",
    ink: "paper",
    alpha: 0.95,
    ground: "paper",
    kind: "ground",
    note: "a sticky bar's ground, blurred, over arbitrary scrolled content",
  },
  {
    utility: "bg-ink/40",
    ink: "ink",
    alpha: 0.4,
    ground: "paper",
    kind: "ground",
    note: "the full-screen backdrop behind the centered coaching dialog",
  },
];

/** `ink` composited onto `ground` at `alpha`, as a hex. */
function composite(ink: string, ground: string, alpha: number): string {
  const mix = [1, 3, 5].map((i) => {
    const a = parseInt(ink.slice(i, i + 2), 16);
    const b = parseInt(ground.slice(i, i + 2), 16);
    return Math.round(a * alpha + b * (1 - alpha));
  });
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** The bloom ground, derived once the colours and `composite` are in hand. */
function bloomGround(): string {
  return composite(COLOURS.bloom, COLOURS.paper, bloomPeak);
}

describe("contrast, computed from the declared values", () => {
  it("keeps the hero legible over the cloud, not only over paper", () => {
    const ground = bloomGround();
    for (const ink of INKS) {
      const ratio = contrast(COLOURS[ink], ground);
      expect(
        ratio,
        `--color-${ink} on the bloom (${ground}, peak ${bloomPeak}) is ${ratio.toFixed(2)}:1, below AA 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // And the boundary token, because both hero CTAs are drawn on this ground
    // and the secondary one has no fill: its border is the only thing saying
    // it is a control.
    const border = contrast(COLOURS.field, ground);
    expect(
      border,
      `--color-field on the bloom (${ground}, peak ${bloomPeak}) is ${border.toFixed(2)}:1, below 3`,
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(INKS)("%s clears AA on every ground", (ink) => {
    for (const ground of GROUNDS) {
      const ratio = contrast(COLOURS[ink], COLOURS[ground]);
      expect(
        ratio,
        `--color-${ink} on --color-${ground} is ${ratio.toFixed(2)}:1, below AA 4.5`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("computes every opacity modifier in the tree, and lets none go undeclared", () => {
    // Find them rather than trust the table. A modifier that exists in the
    // source and not in COMPOSITES is the failure mode this is written for.
    //
    // The pattern is wide on purpose. It used to be
    // `(text|bg|border|decoration|divide|ring|outline)-TOKEN/NN`, and a
    // reviewer walked a control straight through it with `border-b-ink/20` and
    // `text-ink/[0.35]`, painting 1.45:1 and 2.00:1 on the same button whose
    // 1.99:1 and 3.73:1 this table exists to have caught.
    const found = new Set<string>();
    const sources = [emitted, ...FILES.map((f) => withoutComments(readFileSync(join(webRoot, f), "utf8")))];
    const names = Object.keys(COLOURS).join("|");
    const PROPS =
      "text|placeholder|decoration|fill|border|outline|ring|divide|stroke|bg|shadow|accent|caret";
    const modifier = new RegExp(
      `\\b(?:[a-z-]+:)*(?:${PROPS})(?:-[trblxy])?-(?:${names})/(?:\\d+|\\[[\\d.]+\\])`,
      "g",
    );
    for (const source of sources) {
      for (const hit of source.match(modifier) ?? []) {
        // Normalise the variant prefix away: `hover:text-ink/50` is the same
        // paint question as `text-ink/50`, asked about a state.
        found.add(hit.replace(/^(?:[a-z-]+:)+/, ""));
      }
    }

    const declared = new Set(COMPOSITES.map((c) => c.utility));
    expect(
      [...found].filter((u) => !declared.has(u)),
      "an opacity modifier renders a colour nothing computes: add it to COMPOSITES with the ground it sits on and the KIND of thing it is",
    ).toEqual([]);

    for (const entry of COMPOSITES) {
      expect(found, `COMPOSITES lists ${entry.utility}, which no longer renders`).toContain(
        entry.utility,
      );
      // The kind must match the utility. Declaring `text-ink/45` a "ground" is
      // how a 2.52:1 control label got waved through.
      expect(
        entry.utility,
        `${entry.utility} is declared kind "${entry.kind}", which its prefix does not support`,
      ).toMatch(KIND_PREFIXES[entry.kind]);

      const bar = BARS[entry.kind];
      if (bar === null) continue;
      const painted = composite(COLOURS[entry.ink], COLOURS[entry.ground], entry.alpha);
      const ratio = contrast(painted, COLOURS[entry.ground]);
      expect(
        ratio,
        `${entry.utility} paints ${painted} on --color-${entry.ground}: ${ratio.toFixed(2)}:1, below the ${entry.kind} bar of ${bar}`,
      ).toBeGreaterThanOrEqual(bar);
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
    // The filled control: paper label on an ink fill.
    expect(contrast(COLOURS.paper, COLOURS.ink)).toBeGreaterThanOrEqual(4.5);

    // The ring itself, READ FROM THE STYLESHEET.
    //
    // Two versions of this have now failed to check it. The first asserted
    // ink-on-paper twice with the arguments swapped. The second looped over
    // grounds but still compared `COLOURS.ink`, a property of the token rather
    // than of the declaration, so a reviewer repointed the outline at
    // `var(--color-hairline)` — the token this stylesheet declares decorative
    // and deliberately under 3:1 — and the whole suite stayed green with a
    // 1.23:1 focus ring.
    const outline = declaredCss.match(/outline:\s*[^;]*var\(--color-([a-z-]+)\)/);
    expect(outline, "no focus outline is declared from a token").not.toBeNull();
    const ringToken = outline![1];
    const ring = COLOURS[ringToken];
    expect(ring, `--color-${ringToken} is not a declared colour`).toBeDefined();

    // It is drawn outside the element, so what it has to be visible against is
    // the ground the element sits on. Every ground, because keyboard focus
    // reaches controls inside cards and sunk panels too.
    for (const ground of ["paper", "paper-sunk", "surface"]) {
      const ratio = contrast(ring, COLOURS[ground]);
      expect(
        ratio,
        `the focus ring (--color-${ringToken}) on --color-${ground} is ${ratio.toFixed(2)}:1, below 3`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
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

  it("sets the root scale once, relative to the reader, and floored", () => {
    // This asserted the literal string `font-size: 87.5%` and so protected a
    // spelling rather than a property. The property has three parts and the
    // middle one is the part that had actually broken.
    const htmlBlock = declaredCss.slice(declaredCss.search(/\bhtml\s*\{/));
    const rule = htmlBlock.slice(0, htmlBlock.indexOf("}"));
    const declarations = rule.match(/font-size\s*:[^;]+/g) ?? [];

    // 1. Once. Two root font sizes is how a scale silently becomes two scales.
    expect(declarations.length, "the root scale is not declared exactly once").toBe(1);
    const value = declarations[0]!;

    // 2. Relative to the reader. A bare px root overrides someone who has
    //    enlarged their browser text, and this product is read by people doing
    //    a hard thing in a second language; that setting is not decoration.
    expect(value, "the root scale stopped multiplying the reader's own setting").toMatch(/%/);

    // 3. Floored, and this is the one that was missing. A bare percentage
    //    COMPOUNDS: measured in a real browser on 2026-08-04, a machine whose
    //    default is 14px rather than 16px rendered a 12.25px root, an 11.48px
    //    body against a 13.1px target, and a 784px reading column against 896.
    //    The design was being judged 12.5% smaller than it was drawn. A floor
    //    at the measured size is what stops the reduction the reader never
    //    asked for, so the floor is the assertion, not the exact function.
    const floor = value.match(/clamp\(\s*(\d+(?:\.\d+)?)px/);
    expect(floor, `the root scale has no px floor: ${value.trim()}`).not.toBeNull();
    expect(Number(floor![1]), "the floor is below the size the design was measured at")
      .toBeGreaterThanOrEqual(14);

    // And nothing in the vocabulary compensates for any of it with a literal.
    expect(emitted).not.toMatch(/text-\[\d/);
  });

  // The entry motion ships its HIDDEN state in the server HTML: motion cannot
  // know either of these preferences before hydration, so every revealed block
  // arrives as `opacity:0;transform:translateY(12px)`. Nine such blocks on the
  // landing, two on /faq, measured from the built server output.
  //
  // That makes both of these rules load-bearing rather than polish. Each one
  // is the only thing standing between a class of reader and a page that is
  // fully present in the DOM and completely invisible.
  //
  // Reduced motion is the one that had actually broken. The component branch
  // for it returns a plain <div> with no style, and React does not remove a
  // server-rendered attribute the client did not re-declare, so the opacity
  // stayed at 0 forever. The accommodation blanked the page for the readers it
  // was built for, and `tests/landing-motion.test.ts` passed throughout,
  // because it regex-matches the component's source instead of rendering it.
  //
  // These assertions therefore check the rule INSIDE its media block. The
  // version they replace matched `[data-reveal]` anywhere in the stylesheet,
  // which the `scripting: none` block satisfied on its own.
  it.each([
    ["prefers-reduced-motion: reduce", /@media\s*\(prefers-reduced-motion:\s*reduce\)/],
    ["scripting: none", /@media\s*\(scripting:\s*none\)/],
  ])("un-hides every revealed block under (%s)", (condition, opener) => {
    const at = declaredCss.search(opener);
    expect(at, `no @media (${condition}) block`).toBeGreaterThan(-1);

    // Take the whole block by brace balance: these blocks nest rules.
    let depth = 0;
    let end = at;
    for (let i = declaredCss.indexOf("{", at); i < declaredCss.length; i += 1) {
      if (declaredCss[i] === "{") depth += 1;
      else if (declaredCss[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const block = declaredCss.slice(at, end);

    const rule = block.match(/\[data-reveal\][^{]*\{([^}]*)\}/);
    expect(rule, `@media (${condition}) does not reach [data-reveal]`).not.toBeNull();
    // `!important` is not optional: what it has to beat is an inline style.
    expect(rule![1], "opacity is not forced back to 1").toMatch(/opacity:\s*1\s*!important/);
    expect(rule![1], "the translate is not cleared").toMatch(/transform:\s*none\s*!important/);
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
    for (const button of [
      "PRIMARY_BUTTON",
      "CTA_BUTTON",
      "SECONDARY_BUTTON",
      "CTA_SECONDARY_BUTTON",
      "DANGER_BUTTON",
    ]) {
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
    for (const chip of ["CHIP_SKY", "CHIP_BLUSH", "CHIP", "CHIP_READY", "CHIP_ALARM"]) {
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

    // The asset has to be well-formed XML, and this is not a theoretical
    // check. Three versions of this file rendered nothing at all while
    // serving a clean 200, because a comment inside it documented the
    // `-` `-color-bloom` token by name and a double hyphen inside an XML
    // comment is a parse error. The browser fetched the file, failed to parse
    // it, and painted nothing; a solid colour on the same box painted fine,
    // which is what finally separated "the container is wrong" from "the
    // image is wrong". A malformed SVG fails loudly here instead.
    const svg = readFileSync(join(webRoot, "public/hero-bloom.svg"), "utf8");
    const commentBodies = [...svg.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    for (const body of commentBodies) {
      expect(body, "a double hyphen inside an XML comment is a parse error").not.toContain("--");
    }
    expect(svg).toContain("<svg");
    expect(svg).toMatch(/viewBox=/);

    // The one colour literal allowed to live outside globals.css, and the
    // reason it is allowed: an SVG loaded through background-image gets no
    // access to the page's custom properties, so it cannot read the token. The
    // token is still the declaration of record, and this is what keeps the two
    // from drifting. Every stop must be the bloom value and nothing else.
    const svgHexes = new Set(
      [...svg.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toUpperCase()),
    );
    expect(svgHexes.size, "hero-bloom.svg paints more than one colour").toBe(1);
    expect(
      [...svgHexes][0],
      "hero-bloom.svg has drifted from the --color-bloom token",
    ).toBe(COLOURS.bloom);
    // Intrinsic dimensions: an SVG with only a viewBox has no reliable default
    // size as a CSS background image.
    expect(svg).toMatch(/\bwidth="\d+"/);
    expect(svg).toMatch(/\bheight="\d+"/);

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
