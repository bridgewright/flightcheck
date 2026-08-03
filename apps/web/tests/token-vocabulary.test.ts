import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The gate the F-21 spec asked for, and the one the batch did not actually
// build until the Phase 4 review caught it.
//
// Two files claimed it existed. tests/design-system.test.ts opened with "the
// rule is whatever CI fails on", and lib/ui.ts said "F-21 fixed that by
// widening the gate, not by restating the rule". Neither was true: both scans
// read lib/ui.ts alone, so the 43 files this batch de-literalised were
// protected nowhere. A reviewer added `text-red-600 dark:text-red-300` to
// app/sessions/page.tsx and the full suite stayed green.
//
// That is precisely the v0.6 failure this batch set out to close: a house rule
// that held exactly as far as a test enforced it, and no further. So the scan
// is a real directory walk over every screen, and it fails on the four things
// that would let the system decay:
//
//   a raw Tailwind palette utility, which is a colour outside the tokens
//   a `dark:` variant, which the light-only decision (D1) depends on
//   an arbitrary colour value, which is a hex the contrast matrix cannot see
//   a pixel-literal font size, which does not scale with the 87.5% root
//
// Exemptions are a named list with a reason each, never a loosened pattern.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Files that may carry a literal, and why. Each entry is a decision someone
 * has to argue with rather than a hole someone can widen.
 */
const EXEMPT: Record<string, string> = {
  "app/opengraph-image.tsx":
    "satori renders the OG card before Tailwind exists, so a var() here would " +
    "draw nothing. Its four hexes are kept in step with globals.css by hand.",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(webRoot, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(webRoot, rel)).isDirectory()) {
      out.push(...walk(rel));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(rel);
  }
  return out;
}

const FILES = [...walk("app"), ...walk("components"), ...walk("lib")].filter(
  (file) => !(file in EXEMPT),
);

/** Source with comments blanked out: a rule that explains itself must not fail on
 * its own explanation. */
function emitted(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const PALETTE =
  "neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|" +
  "emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const PROP =
  "text|bg|border|divide|ring|from|via|to|placeholder|decoration|fill|stroke|outline|shadow|accent|caret";

function offenders(source: string, pattern: RegExp): string[] {
  return emitted(source)
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, number }) => `${number}: ${line.slice(0, 110)}`);
}

describe("every screen speaks the token vocabulary", () => {
  it("has the whole product in scope, not one file", () => {
    // The bug this suite exists to fix was a scan that covered one module and
    // said it covered the tree. If this count ever collapses, the gate has
    // quietly stopped gating.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES).toContain("app/sessions/page.tsx");
    expect(FILES).toContain("components/SessionRoom.tsx");
    expect(FILES).toContain("lib/report-format.ts");
  });

  it.each(FILES)("%s uses no raw Tailwind palette colour", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    // `sky` needs a digit to count: bg-sky is the product's own token.
    const raw = new RegExp(`\\b(?:${PROP})-(?:${PALETTE})-\\d{2,3}\\b`);
    expect(offenders(source, raw)).toEqual([]);
  });

  it.each(FILES)("%s carries no dark-mode variant", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    expect(offenders(source, /\bdark:/)).toEqual([]);
  });

  it.each(FILES)("%s hard-codes no colour value", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    // An arbitrary value is a colour the contrast matrix in
    // design-system.test.ts cannot see, which is the whole reason that matrix
    // is trustworthy.
    expect(offenders(source, /\[#[0-9a-fA-F]{3,8}\]|\[(?:rgb|hsl|oklch|oklab)a?\(/)).toEqual([]);
  });

  it.each(FILES)("%s paints no gradient of its own", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    // design-system.test.ts holds the stylesheet to zero gradients, and that
    // check was described in two places as if it bound the product. It binds
    // one file. A screen could reach for `bg-[linear-gradient(...)]` or
    // `bg-linear-to-r` and pass every gate in the batch, which is exactly the
    // purple-to-blue AI wash the design skills name as the first tell.
    //
    // The product's two real gradients are both deliberate and neither is a
    // class: the radial stops inside `public/hero-bloom.svg`, and
    // `PLACEHOLDER_HATCH`, which is a CSS value passed through `style` so that
    // it reads as a hatch and can never be mistaken for a screenshot.
    expect(
      offenders(source, /-\[(?:repeating-)?(?:linear|radial|conic)-gradient/),
    ).toEqual([]);
    expect(offenders(source, /\bbg-(?:gradient|linear|radial|conic)-to-[a-z]+\b/)).toEqual([]);
  });

  it.each(FILES)("%s sizes type from the scale, not from pixels", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    // The root is 87.5%, so the scale multiplies the reader's own browser
    // text-size setting. A px literal opts that reader out silently.
    expect(offenders(source, /\btext-\[\d+(?:\.\d+)?px\]/)).toEqual([]);
  });
});

describe("the exemptions are a list, not a loophole", () => {
  it("names a reason for each", () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${file} is exempt without a reason`).toBeGreaterThan(40);
      // An exemption for a file that no longer exists is a hole nobody is watching.
      expect(() => statSync(join(webRoot, file))).not.toThrow();
    }
  });

  it("keeps the list short enough to read", () => {
    expect(Object.keys(EXEMPT).length).toBeLessThanOrEqual(3);
  });
});

export const SCANNED = relative(webRoot, webRoot);
