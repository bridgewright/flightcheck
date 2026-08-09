import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// DECISIONS 060 retired the free full session. What replaced it is a
// five-minute unscored quick interview, and registering a job description
// stays free up to the rubric; every scored session is paid.
//
// The retirement went out with sentences still promising the old model on
// six surfaces at once: the landing's closing block ("The first session is
// scored in full"), the refund policy ("Your first package starts as a trial
// with a full session"), checkout ("Your first session is a free trial"), its
// cancel page, the rubric screen ("Your trial session is used"), and two
// empty states. Each one was true of a product that no longer exists, and the
// landing's was directly above a CTA that now opens the unscored interview.
//
// So the claim gets a gate rather than a proofread.
//
// What it catches: any of the retired sentences written as prose in a source
// file under app, components or lib — including the two shapes that defeated
// the first version of this gate, which matched raw source text. Prettier
// wraps JSX prose at 80 columns, so "The first\n  session is free" is what
// half these sentences would actually look like on disk; and inline markup
// ("your first session is <strong>free</strong>") splits the same phrase with
// a tag. Both read as the claim and neither matched. The source is flattened
// before matching now: tags to a space, JSX whitespace expressions to a
// space, every whitespace run to one space.
//
// What it cannot catch, and must not be described as catching: a claim
// assembled at runtime. `"Your first session is " + verdict`, a sentence in a
// data module read through a variable, or copy pulled from a template with
// the noun interpolated are all invisible here, as is tone. This gate closes
// the way the sentence gets written, not every way it could be produced.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(webRoot, dir));
  return out;
}

/**
 * Source down to the sentences a reader would see, on one line.
 *
 * Comments go first: they carry the history of the retired model on purpose.
 * Then the two things that sit inside a sentence without being part of it —
 * a JSX tag, and the `{" "}` prettier leaves at a wrapped line's end — become
 * a space, and every whitespace run collapses to one. A phrase split by a
 * line break or a `<strong>` is the same phrase to whoever reads the page.
 *
 * The tag pattern requires a letter after the bracket and allows no bracket
 * inside, so `a < b` and `=>` are left alone; a generic like `Record<string,
 * X>` is eaten, which costs nothing here.
 */
function flattenProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/<\/?[A-Za-z][^<>]*>/g, " ")
    .replace(/\{\s*["'`]\s*["'`]\s*\}/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Sentences that would put the retired offer back in front of a reader.
 *
 * Deliberately narrow. "trial" alone is not a hit: `is_trial` is real history
 * on real rows and the Polar webhook still matches on it, and a gate that
 * banned the word would be answered by renaming the word.
 */
const RETIRED_CLAIMS: [RegExp, string][] = [
  [/\btrial session\b/i, "the trial session is retired (DECISIONS 060)"],
  [/\bfree trial\b/i, "there is no free trial; the free door is the quick interview"],
  [/\bstarts as a trial\b/i, "packages no longer start as trials"],
  [
    /\bfirst session\s+is\s+(free|scored|a\b)/i,
    "the first scored session is paid like every other one",
  ],
  [
    /\bfirst session free\b/i,
    "the first scored session is paid like every other one",
  ],
];

function retiredClaimIn(source: string): string | null {
  const prose = flattenProse(source);
  for (const [pattern, why] of RETIRED_CLAIMS) {
    const hit = prose.match(pattern);
    if (hit) return `"${hit[0]}" — ${why}`;
  }
  return null;
}

describe("the retired trial", () => {
  it("is promised on no screen", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const claim = retiredClaimIn(readFileSync(file, "utf8"));
      if (claim !== null) offenders.push(`${file.slice(webRoot.length)}: ${claim}`);
    }
    expect(offenders).toEqual([]);
  });

  it("is not answered by a line break or an inline tag", () => {
    // Every one of these reads as the retired promise on the rendered page,
    // and none of them matched the first version of this gate. The first two
    // are not adversarial: they are what prettier does to JSX prose at 80
    // columns and what anyone emphasising a word writes.
    const evasions = [
      'return (\n  <p>\n    The first\n    session is free.\n  </p>\n);',
      "<p>Your first session is <strong>free</strong>.</p>",
      "<p>Your <em>trial</em> session is used.</p>",
      '<p>Start your free{" "}\ntrial today.</p>',
      "<li>\n  Your first\n  session is scored in full\n</li>",
    ];
    for (const evasion of evasions) {
      expect(retiredClaimIn(evasion), evasion).not.toBeNull();
    }
  });

  it("still reads comments as history rather than as claims", () => {
    // The retirement's own record lives in comments across this repo, and a
    // gate that failed on them would be answered by deleting the history.
    expect(retiredClaimIn("// Your first session is free.\n")).toBeNull();
    expect(retiredClaimIn("/* the old free trial */\n")).toBeNull();
  });

  it("says plainly what it cannot see", () => {
    // The honest limit, pinned so the comment above cannot quietly grow into
    // a promise this gate does not keep: a sentence assembled at runtime is
    // invisible here.
    expect(retiredClaimIn('const line = "Your first session is " + word;')).toBeNull();
  });

  it("keeps its data, which is a different thing", () => {
    // Historical rows keep is_trial and the webhook still needs it to pick
    // which unpaid package an order unlocks. Retiring the OFFER must never
    // turn into deleting the RECORD.
    const webhook = readFileSync(
      join(webRoot, "app/api/webhooks/polar/route.ts"),
      "utf8",
    );
    expect(webhook).toContain("pkg.is_trial === true");
    const worker = readFileSync(join(webRoot, "lib/worker.ts"), "utf8");
    expect(worker).toContain("is_trial?: boolean;");
  });

  it("left no constant behind for a surface to read", () => {
    const pricing = readFileSync(join(webRoot, "lib/pricing.ts"), "utf8");
    expect(pricing).not.toContain("TRIAL_SESSIONS");
    expect(pricing).toContain("PACKAGE_SESSIONS");
  });
});
