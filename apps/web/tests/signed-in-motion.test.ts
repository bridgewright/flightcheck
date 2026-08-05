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

// --- The new leaves consume the budget, never restate it -----------------

/** The leaves this feature added. landing-motion.test.ts already runs its
 * directory-wide scans over them; these checks are the ones it does not make. */
const NEW_LEAVES = [
  "components/motion/Sweep.tsx",
  "components/motion/CountUp.tsx",
];

describe("the new leaves consume entry.ts rather than re-declaring it", () => {
  // The budget is one module so it cannot drift between leaves. A leaf that
  // writes `duration: 0.3` agrees with the budget today and diverges the day
  // the budget changes.
  it.each(NEW_LEAVES)("%s imports the shared vocabulary", (file) => {
    expect(read(file)).toContain('from "./entry"');
  });

  it.each(NEW_LEAVES)("%s re-declares no duration, curve, or viewport", (file) => {
    const code = withoutComments(read(file));
    expect(code, "a literal duration restates ENTRY_SECONDS").not.toMatch(
      /duration:\s*[\d.]/,
    );
    expect(code, "a literal curve restates the eases").not.toMatch(/ease:\s*\[/);
    expect(code, "a literal viewport restates ENTRY_VIEWPORT").not.toMatch(
      /once:\s*(true|false)/,
    );
  });
});

describe("the gauge's reading sweeps in through the leaf", () => {
  it("draws the reading with Sweep, handed only its offset", () => {
    const gauge = read("components/ReadinessGauge.tsx");
    expect(gauge).toContain('from "@/components/motion/Sweep"');
    expect(gauge).toContain("<Sweep percent={");
  });

  it("sweeps once per first view, and never on a poll refresh", () => {
    // once:true via the shared constant, and no `animate=` mount trigger: a
    // mount trigger would replay if the tree ever remounted, and the viewport
    // trigger is what "first view" means.
    const leaf = read("components/motion/Sweep.tsx");
    expect(leaf).toContain("ENTRY_VIEWPORT");
    expect(leaf).toContain("whileInView");
  });

  it("settles at transform none, which is what the CSS backstops render", () => {
    // The mover animates x from -percent% back to 0, so the settled state is
    // no transform at all. Both globals.css backstops write
    // `transform: none !important` on [data-reveal]; if the settled state
    // ever becomes a meaningful transform (a scaleX fill), a no-JS reader is
    // shown a full bar, which is a wrong number rather than a missing nicety.
    const leaf = withoutComments(read("components/motion/Sweep.tsx"));
    expect(leaf).toContain('x: "0%"');
    expect(leaf).not.toMatch(/scaleX/);
  });
});

describe("the report's overall score counts up once", () => {
  // F-21 spec section 6 granted exactly this moment: state transition, the
  // number is the product's output. Nobody built it then; F-58 does.
  it("is the verdict number that counts, at two decimals", () => {
    const view = read("components/ReportView.tsx");
    expect(view).toContain('from "@/components/motion/CountUp"');
    expect(view).toContain("<CountUp value={report.overall_score} decimals={2} />");
  });

  it("counts once per mount and only snaps thereafter", () => {
    // A poll refresh preserves the client instance, so the played guard is
    // what "once" means; a later value change updates the number without a
    // second performance.
    const leaf = withoutComments(read("components/motion/CountUp.tsx"));
    expect(leaf).toContain("useRef");
    expect(leaf).toContain("played");
  });

  it("cannot change width while it runs", () => {
    // The server renders the final value and every animation frame renders
    // toFixed(decimals), so the digit count is constant; the call site above
    // sits inside SCORE_NUMBER, whose tabular-nums makes equal digit counts
    // equal widths.
    const leaf = withoutComments(read("components/motion/CountUp.tsx"));
    expect(leaf).toContain(".toFixed(decimals)");
    expect(read("lib/ui.ts")).toMatch(/SCORE_NUMBER = "[^"]*tabular-nums/);
  });

  it("renders the final number for readers without the animation", () => {
    // The reduced-motion branch and the server render both state the score
    // outright; the count is only for the reader who is there when the
    // number arrives.
    const leaf = withoutComments(read("components/motion/CountUp.tsx"));
    expect(leaf).toContain("useState(value)");
    expect(leaf).toContain("value.toFixed(decimals)");
  });
});
