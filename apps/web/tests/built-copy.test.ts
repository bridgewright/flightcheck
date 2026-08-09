import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The gate for a defect no source-reading test can see.
//
// /rubric shipped to production reading:
//
//   "Ready takes both at once: an overall of 4.0single dimension below 3.0."
//
// The source said "an overall of 4.0 or better, and no single dimension below
// 3.0", vitest printed that same correct string, and every gate in this
// directory passed. The corruption was created by the production bundler.
//
// The trigger: a module-scope constant string, `+`-concatenated from template
// literals whose interpolations are all compile-time values. `UNSCORED_READING`
// is a module-level const calling a pure function, so the whole call was
// foldable; folding the `+` chain dropped the literal text that followed the
// last interpolation of each part. A second instance corrupted the readiness
// gauge's screen-reader sentence to "4.0 out of 5with no dimension below 3.0",
// which is what a blind reader was being told the bar was.
//
// Two checks, because either alone leaves the hole open:
//
//   1. The SHAPE, in source, always. Written as one template literal there is
//      no concatenation to fold. This is the cheap check and it runs every time.
//   2. The RESULT, in the build, when a build exists. This is the only check
//      that sees what a reader actually gets, and it is why the sequence is
//      `next build` and then `vitest run` rather than the other way round.

const webRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Modules whose strings reach a screen. A `+` chain here is banned outright
 * rather than judged case by case: whether a given one is foldable today
 * depends on whether its interpolations happen to be constants, which is one
 * refactor away from changing under everyone.
 */
const COPY_MODULES = [
  "lib/verdict.ts",
  "lib/report-format.ts",
  "lib/home.ts",
  "lib/start-session.ts",
  "lib/rubric-format.ts",
  "components/ReadinessGauge.tsx",
  "components/landing/copy.ts",
  "app/legal/policy.ts",
];

function withoutComments(source: string): string {
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

describe("copy is built as whole strings, not joined ones", () => {
  it.each(COPY_MODULES)("%s joins no template literal with +", (file) => {
    const source = withoutComments(readFileSync(join(webRoot, file), "utf8"));
    const offenders = source
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      // a template literal carrying an interpolation, ending the line with `+`
      .filter(({ line }) => /`[^`]*\$\{[^}]*\}[^`]*`\s*\+\s*$/.test(line))
      .map(({ line, number }) => `${file}:${number}: ${line.slice(0, 100)}`);
    expect(
      offenders,
      "write this as one template literal: a + chain of interpolated templates can be folded by the bundler, and folding drops the text after the last interpolation",
    ).toEqual([]);
  });
});

/**
 * Sentences a reader sees, as they must appear after building.
 *
 * Each one is a fragment that STARTS right after an interpolation, because
 * that is exactly the text the folding bug drops. A fragment rather than the
 * whole sentence, since a value that is not compile-time constant stays as
 * `${...}` in the chunk and the leading number would never match.
 */
const CANONICAL = [
  // lib/verdict.ts, the one that reached production broken
  "an overall of 4.0 or better, and no single dimension below 3.0.",
  // components/ReadinessGauge.tsx, the screen-reader sentence
  "The Ready bar is 4.0 out of 5 overall, with no dimension below 3.0.",
  // components/landing/copy.ts, both merged chains
  "minutes, out loud, in English. Speech both ways, so pace and hesitation",
  "sessions on one job description, with no repeated questions within the",
  "minute quick interview is free. Registering a job description",
  // app/legal/policy.ts
  "and all data attached to it.",
  // lib/rubric-format.ts, the delivery receipt line on /rubric
  "how you sound is part of every interview.",
];

function builtChunks(): string[] {
  const root = join(webRoot, ".next/server");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) out.push(full);
    }
  };
  walk(root);
  return out;
}

describe("the built bundle says what the source says", () => {
  const chunks = builtChunks();

  // This used to `console.warn` and pass. It never printed: vitest does not
  // surface console output from a passing test under this runner, so the
  // "inert" state was indistinguishable from the "verified" state — fourteen
  // green tests, six of which asserted nothing, on a clean checkout. A gate
  // whose failure mode is silence is not a gate.
  //
  // So the absence of a build is now reported as SKIPPED rather than passed.
  // Skips are counted separately in vitest's summary, which makes the state
  // visible in the one place everybody already looks. It is deliberately not a
  // hard failure: `npm test` on a fresh clone has no `.next` and should not
  // fail for it. `npm run gates` builds first, which is why it exists.
  const built = chunks.length > 0;

  it.skipIf(!built)("has a build to read", () => {
    expect(chunks.length).toBeGreaterThan(0);
  });

  it.skipIf(!built).each(CANONICAL)(
    "keeps %s intact through the bundler",
    (sentence) => {
      const found = chunks.some((f) =>
        readFileSync(f, "utf8").includes(sentence),
      );
      expect(
        found,
        `the built bundle does not contain this sentence. The bundler may have folded it apart, which is how "an overall of 4.0single dimension below 3.0" reached production`,
      ).toBe(true);
    },
  );
});
