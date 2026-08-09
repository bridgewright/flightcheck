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
// So the claim gets a gate rather than a proofread. What this cannot check is
// tone; what it can check is that nobody promises a free scored session again.

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

/** Prose only: comments carry the history of the retired model on purpose. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");
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

describe("the retired trial", () => {
  it("is promised on no screen", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const prose = withoutComments(readFileSync(file, "utf8"));
      for (const [pattern, why] of RETIRED_CLAIMS) {
        const hit = prose.match(pattern);
        if (hit) {
          offenders.push(`${file.slice(webRoot.length)}: "${hit[0]}" — ${why}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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
