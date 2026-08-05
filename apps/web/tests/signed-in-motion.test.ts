import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-58: the signed-in product animates its own data. tests/landing-motion.test.ts
// is the model and still guards the leaf directory itself (every .tsx file under
// components/motion, including the leaves added here, passes through its scans:
// client boundary, presentational props, reduced-motion branch, transform and
// opacity only, data-reveal carried). This file holds what that one cannot see:
// the signed-in CONSUMERS. A consumer that re-declares a duration, animates a
// layout property inline, or hands a leaf a session object would pass every
// check in landing-motion.test.ts, because that file never reads these screens.
//
// Motion budget and its reasoning: DECISIONS 031 and 035, encoded in
// components/motion/entry.ts.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

/**
 * Source with comments blanked out, line count preserved. Same idiom as
 * tests/verdict-single-source.test.ts: these files explain in comments the
 * exact mechanism they refuse to ship, and the explanation must not be what
 * fails the scan.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

describe("the gauge positions its marks with transform alone", () => {
  // The budget forbids animating width and left. A gauge whose static
  // geometry is written as width and left is one innocent-looking transition
  // away from breaking that rule, so the refactor moved every mark onto
  // transform and this scan holds it there.
  it("writes no inline width or left, on any mark", () => {
    const code = withoutComments(read("components/ReadinessGauge.tsx"));
    expect(code).not.toMatch(/\b(width|left|top|right|bottom|height)\s*:/);
  });

  it("places every mark by translating it", () => {
    const code = withoutComments(read("components/ReadinessGauge.tsx"));
    expect(code).toContain("translateX(");
  });

  it("clips the rail on x, which the full-width fill relies on for its left edge", () => {
    expect(read("components/ReadinessGauge.tsx")).toContain("overflow-x-clip");
  });
});
