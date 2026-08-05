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
  "components/motion/MountFade.tsx",
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

describe("the signed-in tree enters with the landing's vocabulary", () => {
  // The same Reveal, the same stagger arithmetic as the landing's
  // how-it-works: one entry vocabulary for the whole product, not a second
  // dialect behind the login.
  it("staggers the trajectory cards like the landing's steps", () => {
    const source = read("components/ProgressTrajectory.tsx");
    expect(source).toContain('from "@/components/motion/Reveal"');
    expect(source).toContain("* ENTRY_STAGGER_SECONDS");
  });

  it("staggers the session rows the same way", () => {
    const source = read("components/SessionList.tsx");
    expect(source).toContain('from "@/components/motion/Reveal"');
    expect(source).toContain("* ENTRY_STAGGER_SECONDS");
  });

  it("raises the journey strip as one object, not dot by dot", () => {
    // The strip is one accessible picture (role img); sequencing its dots
    // would argue with the thing the strip is.
    const source = read("components/JourneyStrip.tsx");
    expect(source).toContain('from "@/components/motion/Reveal"');
    expect(source).not.toContain("ENTRY_STAGGER_SECONDS");
  });
});

describe("a status that flips under PollRefresh fades in instead of teleporting", () => {
  // router.refresh() swaps server-rendered content wholesale. The honest
  // minimal version of continuity in that model: key the fade on the status,
  // so React remounts the changed cell and the entry plays once. An
  // unchanged key never remounts, so an idle poll tick replays nothing.
  it("keys the session row's outcome cell on its status", () => {
    const source = read("components/SessionList.tsx");
    expect(source).toContain('from "@/components/motion/MountFade"');
    expect(source).toContain("<MountFade key={session.status}>");
  });

  it("keys the trajectory cell's body on its status", () => {
    const source = read("components/ProgressTrajectory.tsx");
    expect(source).toContain('from "@/components/motion/MountFade"');
    expect(source).toContain("<MountFade key={fadeKey}>");
  });

  it("fades without travelling, on the fade curve", () => {
    // Not an entrance in reading order: the same cell it was, with a new
    // value. Opacity only, FADE_EASE, and an animate-on-mount trigger, since
    // the remount is the event.
    const leaf = withoutComments(read("components/motion/MountFade.tsx"));
    expect(leaf).toContain("FADE_EASE");
    expect(leaf).toContain("animate=");
    expect(leaf).not.toMatch(/\bx\b|\by\b|whileInView/);
  });
});

// --- The call sites hand the leaves nothing but presentation -------------

describe("the signed-in call sites pass the leaves only presentational props", () => {
  // Same scan as landing-motion.test.ts's call-site check, over the signed-in
  // consumers, with each leaf's own allowed prop names. The leaves' prop
  // TYPES are already gated directory-wide; this catches a consumer handing
  // a leaf something it should not even be offered.
  const ALLOWED: Record<string, string[]> = {
    Reveal: ["className", "delay", "key"],
    MountReveal: ["className", "key"],
    MountFade: ["className", "key"],
    CountUp: ["value", "decimals", "className", "key"],
    Sweep: ["percent", "key"],
  };

  const CONSUMERS = [
    "components/ReadinessGauge.tsx",
    "components/ReportView.tsx",
    "components/ProgressTrajectory.tsx",
    "components/SessionList.tsx",
    "components/JourneyStrip.tsx",
    "app/home/page.tsx",
    "app/progress/page.tsx",
  ];

  it.each(CONSUMERS)("%s stays within each leaf's allowed props", (file) => {
    const source = read(file);
    for (const [leaf, allowed] of Object.entries(ALLOWED)) {
      for (const tag of source.matchAll(new RegExp(`<${leaf}\\b([^>]*)>`, "g"))) {
        for (const [, prop] of tag[1].matchAll(/(\w+)=/g)) {
          expect(allowed, `${file} passes ${prop} to ${leaf}`).toContain(prop);
        }
      }
    }
  });
});
