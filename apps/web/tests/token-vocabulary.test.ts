import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cookedStrings } from "./scan/cooked";

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
  "components/ReportPdf.tsx":
    "a PDF has no stylesheet and no custom properties, so the export cannot " +
    "read a token; and it is deliberately NOT the paper ground, because a " +
    "report that is printed or attached is read on white. Its five values are " +
    "pinned by tests/report-export.test.ts. The first version of this file " +
    "assembled its hexes from a `#` constant, which passed this scan while " +
    "declaring nothing: an exemption argued here is the only allowed route.",
  "components/StudyPdf.tsx":
    "a session study PDF has no stylesheet or custom properties, so its " +
    "printable Q&A export carries ReportPdf's five test-pinned colours.",
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

/**
 * Every screen file. The exemptions below are applied PER RULE, not by
 * removing a file from this list.
 *
 * `EXEMPT` used to filter here, which dropped app/opengraph-image.tsx from all
 * six rules on a reason that covers only its four hexes. An em-dash in its
 * `alt` export — the string screen readers speak and Slack unfurls — passed
 * silently.
 */
const FILES = [...walk("app"), ...walk("components"), ...walk("lib")];

/** The colour rules the satori exemption actually covers. */
const COLOUR_EXEMPT = (file: string) => file in EXEMPT;

/**
 * Source with whole-line comments blanked out, line count preserved.
 *
 * The scans below are about what a module emits, not what it explains: a file
 * that names the pattern it forbids must not fail the check for that pattern
 * on its own documentation.
 *
 * ONLY lines that BEGIN with a comment marker. The version this replaces fired
 * on any `//` not preceded by a colon, including inside a string, and blanked
 * everything after it on that line. A Round 2 reviewer put a div carrying a
 * template-literal `//status` plus a raw palette class, a dark: variant, a px
 * font size and an em-dash into app/sessions/page.tsx, and the whole suite
 * stayed green: 95 characters of live code erased, taking four of the six
 * rules with it. An unterminated block marker inside a string was worse, since
 * its blast radius ran to the next close marker anywhere in the file.
 *
 * A line-anchored version cannot do that, because a line that starts with a
 * comment marker has no code on it. The trade is that a trailing comment after
 * code is no longer blanked, so a rule can now fail on one. That is the right
 * direction for a gate: a false failure gets read, a silent bypass does not.
 */
function emitted(source: string): string {
  let inBlock = false;
  return source
    .split("\n")
    .map((line) => {
      const blank = " ".repeat(line.length);
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end === -1) return blank;
        inBlock = false;
        return " ".repeat(end + 2) + line.slice(end + 2);
      }
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//")) return blank;
      if (trimmed.startsWith("/*") || trimmed.startsWith("*")) {
        const end = line.indexOf("*/");
        if (end === -1) {
          if (trimmed.startsWith("/*")) inBlock = true;
          return blank;
        }
        return " ".repeat(end + 2) + line.slice(end + 2);
      }
      return line;
    })
    .join("\n");
}

/**
 * Files allowed to keep a dash in a string, and why. Both are prose nobody
 * reads on a screen.
 */
const DASH_EXEMPT: Record<string, string> = {
  "lib/session-room.ts":
    "the silence nudges and the clock notes, which are instructions to the " +
    "interviewer model rather than copy. Rewording them changes the live " +
    "interviewer and is an evals-gated behaviour change, not a register fix.",
  "app/api/webhooks/polar/route.ts":
    "two console.error strings on the fail-closed paths. They reach a server " +
    "log, never a reader.",
};

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
    if (COLOUR_EXEMPT(file)) return;
    const source = readFileSync(join(webRoot, file), "utf8");
    // `sky` needs a digit to count: bg-sky is the product's own token.
    const raw = new RegExp(`\\b(?:${PROP})-(?:${PALETTE})-\\d{2,3}\\b`);
    expect(offenders(source, raw)).toEqual([]);

    // The numberless ones too. `bg-white` and `text-black` carry no digit, so
    // the pattern above never saw them, while the lib/ui.ts-only check this
    // suite was written to generalise did. Pure white on a warm #FBFBF8 paper
    // is exactly the drift the tokens exist to stop.
    const bare = new RegExp(`\\b(?:${PROP})-(?:white|black)\\b`);
    expect(offenders(source, bare)).toEqual([]);
  });

  it.each(FILES)("%s carries no dark-mode variant", (file) => {
    if (COLOUR_EXEMPT(file)) return;
    const source = readFileSync(join(webRoot, file), "utf8");
    expect(offenders(source, /\bdark:/)).toEqual([]);
  });

  it.each(FILES)("%s hard-codes no colour value", (file) => {
    if (COLOUR_EXEMPT(file)) return;
    const source = readFileSync(join(webRoot, file), "utf8");
    // An arbitrary value is a colour the contrast matrix in
    // design-system.test.ts cannot see, which is the whole reason that matrix
    // is trustworthy.
    //
    // Not only inside Tailwind brackets. The bracket-anchored version missed
    // `style={{ color: "#8b5cf6" }}` entirely, which is both a hex the matrix
    // cannot see and, in that particular value, the AI violet the design
    // skills name as the first tell.
    expect(offenders(source, /\[#[0-9a-fA-F]{3,8}\]|\[(?:rgb|hsl|oklch|oklab)a?\(/)).toEqual([]);
    expect(
      offenders(source, /["'`]\s*#[0-9a-fA-F]{3,8}\s*["'`]|\b(?:rgb|hsl|oklch|oklab)a?\(/),
    ).toEqual([]);
  });

  it.each(FILES)("%s puts no dash in a sentence a reader sees", (file) => {
    if (file in DASH_EXEMPT) return;
    const source = readFileSync(join(webRoot, file), "utf8");
    // The em-dash pass rewrote about 110 user-visible strings, and the only
    // gate that survived it covered `app/page.tsx`, `components/landing/*` and
    // `components/motion/*`. That gate's own header said a tree-wide version
    // "lives with the design-system gate"; it did not exist. Roughly a hundred
    // rewritten strings were ungated, which is how the rewrite would have come
    // undone one sentence at a time.
    //
    // Strings and JSX text only, not comments. The landing gate bans the
    // character in its comments too and that is right for the files a reader's
    // first impression is assembled from, but the tree carries about 360
    // comment lines using it as an aside, and rewriting explanations wholesale
    // to satisfy a copy rule would damage more than it protects.
    const body = emitted(source);
    const strings = [
      ...(body.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []),
      ...(body.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []),
      ...(body.match(/`(?:[^`\\]|\\.)*`/g) ?? []),
      // JSX text.
      //
      // The first version of this was `/>[^<>{}]*</g`, which excluded `{` and
      // so could not see any sentence interrupted by an expression. That is
      // every sentence quoting a number, and a Round 2 reviewer found 19 such
      // prose runs across 12 files invisible to it, including the confirmation
      // sentence Round 1 had just rewritten. The gate built because ~110
      // strings were ungated could not read the ones carrying the price, the
      // session count, the expiry, or the refund window.
      //
      // So: take the text between tags, then blank the interpolations inside
      // it rather than refusing to look at the run that contains them. What is
      // inside `{...}` is an expression, and it is covered by the string
      // literal scans above; what surrounds it is prose, and this is the only
      // thing that reads it.
      ...(body.match(/>[^<>]*</g) ?? []).map((run) => run.replace(/\{[^{}]*\}/g, " ")),
    ];
    expect(strings.filter((s) => /[—–]/.test(s))).toEqual([]);
  });

  it.each(FILES)("%s paints no gradient of its own", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    // design-system.test.ts holds the stylesheet to zero gradients, and that
    // check was described in two places as if it bound the product. It binds
    // one file. A screen could reach for `bg-[linear-gradient(...)]` or
    // `bg-linear-to-r` and pass every gate in the batch, which is exactly the
    // purple-to-blue AI wash the design skills name as the first tell.
    //
    // The product's one real gradient is the radial stops inside
    // `public/hero-bloom.svg`, which is an asset rather than a class. This
    // comment named a second, `PLACEHOLDER_HATCH`, for a while after the same
    // batch deleted it, and it was the third copy of a sentence corrected in
    // globals.css and lib/ui.ts. That it survived here is the worst of the
    // three, because this file is the one that decides what CI fails on.
    // Every spelling Tailwind 4.3 accepts, verified against the installed
    // package rather than assumed: bg-linear, bg-radial and bg-conic all
    // exist, and only the linear form takes a `-to-<side>` suffix. The
    // earlier version demanded that suffix, so `bg-radial`, `bg-conic-180`
    // and `bg-linear-45` all passed, as did `bg-[image:linear-gradient(...)]`,
    // which anchored on `-[` being followed immediately by the function.
    expect(offenders(source, /-\[(?:[a-z-]+:)?(?:repeating-)?(?:linear|radial|conic)-gradient/)).toEqual([]);
    expect(offenders(source, /\bbg-(?:gradient|linear|radial|conic)\b/)).toEqual([]);
    // And the inline route: `style={{ backgroundImage: ... }}` reaches no
    // class scan at all, and it is the route the deleted hatch token used, so
    // it is the one someone reading this history would reach for first.
    expect(offenders(source, /backgroundImage|background-image/)).toEqual([]);
  });

  it.each(FILES)("%s builds no page column of its own", (file) => {
    const source = emitted(readFileSync(join(webRoot, file), "utf8"));
    // Nine screens hand-rolled `mx-auto max-w-2xl px-6` and drifted, because
    // none of them goes through Shell: the four loading skeletons, the session
    // room, /new, error, not-found, and the capability-link pages. The design
    // pass moved Shell to max-w-reading / max-w-shell with responsive gutters
    // and widened the reading measure from 46rem to 64rem, and every one of
    // these stayed at 588px. The interview room opened in a 588px column with
    // 445px of blank either side of it.
    //
    // `MAIN_READING` and `MAIN_WIDE` are the two page columns. A screen
    // composes one and adds layout; it does not invent a third.
    //
    // Scoped to <main>, deliberately. A centred narrow block INSIDE a page is
    // ordinary layout: checkout puts its card in a `max-w-md` column on
    // purpose, and a `max-w-3xl` on a heading is a measure rather than a
    // column. What drifted was the page column itself, and only <main> carries
    // one.
    const offenders: string[] = [];
    for (const tag of source.matchAll(/<main\b[^>]*/g)) {
      const attrs = tag[0];
      if (!/\bmax-w-(?:xs|sm|md|lg|xl|\dxl|\[)/.test(attrs)) continue;
      const line = source.slice(0, tag.index).split("\n").length;
      offenders.push(`${line}: ${attrs.replace(/\s+/g, " ").slice(0, 110)}`);
    }
    expect(
      offenders,
      "compose MAIN_READING or MAIN_WIDE instead of writing a page column by hand",
    ).toEqual([]);
  });

  it.each(FILES)("%s sizes type from the scale, not from pixels", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    // The root is 87.5%, so the scale multiplies the reader's own browser
    // text-size setting. A px literal opts that reader out silently.
    expect(offenders(source, /\btext-\[\d+(?:\.\d+)?px\]/)).toEqual([]);
  });
});

describe("the scans read cooked strings, not spellings", () => {
  function cookedOffenders(file: string, source: string): string[] {
    const raw = new RegExp(`\\b(?:${PROP})-(?:${PALETTE})-\\d{2,3}\\b`);
    const bare = new RegExp(`\\b(?:${PROP})-(?:white|black)\\b`);
    const colourRules = [
      raw,
      bare,
      /\bdark:/,
      /^\s*#[0-9a-fA-F]{3,8}\s*$/,
      /\[#[0-9a-fA-F]{3,8}\]/,
      /\b(?:rgb|hsl|oklch|oklab)a?\(/,
    ];
    const rules = [
      ...(COLOUR_EXEMPT(file) ? [] : colourRules),
      /\bbg-(?:gradient|linear|radial|conic)\b/,
      /-\[(?:[a-z-]+:)?(?:repeating-)?(?:linear|radial|conic)-gradient/,
      /^(?:backgroundImage|background-image)$/,
      ...(file in DASH_EXEMPT ? [] : [/[—–]/]),
      /\btext-\[\d+(?:\.\d+)?px\]/,
    ];

    return cookedStrings(source, file)
      .filter(({ value }) => rules.some((rule) => rule.test(value)))
      .map(({ value, line }) => `${file}:${line}: ${JSON.stringify(value).slice(0, 110)}`);
  }

  it.each(FILES)("%s has no forbidden cooked value", (file) => {
    const source = readFileSync(join(webRoot, file), "utf8");
    expect(cookedOffenders(file, source)).toEqual([]);
  });

  it("parses a non-trivial set of strings from the real home page", () => {
    const source = readFileSync(join(webRoot, "app/page.tsx"), "utf8");
    expect(cookedStrings(source, "app/page.tsx").length).toBeGreaterThan(10);
  });
});

describe("the exemptions are a list, not a loophole", () => {
  it.each([
    ["colour and type", EXEMPT],
    ["the dash", DASH_EXEMPT],
  ])("the %s list names a reason for each", (_which, list) => {
    for (const [file, reason] of Object.entries(list)) {
      expect(reason.length, `${file} is exempt without a reason`).toBeGreaterThan(40);
      // An exemption for a file that no longer exists is a hole nobody is watching.
      expect(() => statSync(join(webRoot, file))).not.toThrow();
    }
  });

  it("keeps both lists short enough to read", () => {
    expect(Object.keys(EXEMPT).length).toBeLessThanOrEqual(3);
    expect(Object.keys(DASH_EXEMPT).length).toBeLessThanOrEqual(3);
  });

  it("still needs every dash exemption it claims", () => {
    // An exemption that has stopped being load-bearing is a standing permission
    // nobody re-examines.
    //
    // Read what the RULE reads. This checked the raw source, so a dash in a
    // comment kept an exemption alive after its string-level need was gone:
    // a reviewer rewrote both console.error strings in the polar route to use
    // commas and the exemption survived on four comment lines.
    for (const file of Object.keys(DASH_EXEMPT)) {
      const body = emitted(readFileSync(join(webRoot, file), "utf8"));
      const strings = [
        ...(body.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []),
        ...(body.match(/'(?:[^'\\\n]|\\.)*'/g) ?? []),
        ...(body.match(/`(?:[^`\\]|\\.)*`/g) ?? []),
      ];
      expect(
        strings.filter((str) => /[—–]/.test(str)).length,
        `${file} is exempt from the dash rule but no string in it needs the exemption`,
      ).toBeGreaterThan(0);
    }
  });
});

export const SCANNED = relative(webRoot, webRoot);
