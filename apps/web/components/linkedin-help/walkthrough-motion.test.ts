import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ENTRY_EASE,
  ENTRY_SECONDS,
  FADE_EASE,
} from "@/components/motion/entry";
import type { WalkthroughStep } from "@/components/linkedin-help/walkthrough-steps";
import { ANIM, FLIP_SECONDS, stepSequence } from "@/components/linkedin-help/walkthrough-motion";

// The walkthrough's choreography, held to the motion budget (DECISIONS 031
// and 035). The sequences are data, so the discipline rules are checked on
// the real objects rather than by reading source.

const STEPS: WalkthroughStep[] = [1, 2, 3];

type Segment = readonly [string, Record<string, unknown>, Record<string, unknown>?];

function segments(step: WalkthroughStep): Segment[] {
  return stepSequence(step) as unknown as Segment[];
}

describe("the sequences animate transform and opacity only", () => {
  const ALLOWED_KEYS = ["x", "y", "scale", "opacity"];

  it.each(STEPS)("step %i names no layout property", (step) => {
    for (const [selector, keyframes] of segments(step)) {
      for (const key of Object.keys(keyframes)) {
        expect(ALLOWED_KEYS, `${selector} animates ${key}`).toContain(key);
      }
    }
  });

  it.each(STEPS)("step %i plays once: no repeats, no infinities", (step) => {
    for (const [selector, , options] of segments(step)) {
      expect(options?.repeat, `${selector} repeats`).toBeUndefined();
      for (const value of Object.values(options ?? {})) {
        if (typeof value === "number") {
          expect(Number.isFinite(value), `${selector} carries an infinite value`).toBe(true);
        }
      }
    }
  });

  it("writes no repeat and no infinite iteration in the source either", () => {
    // The object check above sees what the builders return today; this sees a
    // conditional branch a refactor might hide from it.
    const source = readFileSync(
      fileURLToPath(new URL("./walkthrough-motion.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(/Infinity|infinite/);
  });
});

describe("the sequences keep the storyboard's shape", () => {
  it.each(STEPS)("step %i totals well under two seconds", (step) => {
    let end = 0;
    for (const [, , options] of segments(step)) {
      const at = typeof options?.at === "number" ? options.at : 0;
      const duration = typeof options?.duration === "number" ? options.duration : 0;
      const delay = typeof options?.delay === "number" ? options.delay : 0;
      end = Math.max(end, at + delay + duration);
    }
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThan(2);
  });

  it.each(STEPS)("step %i schedules every segment explicitly", (step) => {
    // Relative sequencing drifts when a segment is added; the storyboard's
    // tables are absolute times, so the sequences are too.
    for (const [selector, , options] of segments(step)) {
      expect(typeof options?.at, `${selector} has no explicit at`).toBe("number");
    }
  });

  it("uses only the two house curves", () => {
    for (const step of STEPS) {
      for (const [selector, , options] of segments(step)) {
        if (options?.ease === undefined) continue;
        expect(
          [ENTRY_EASE, FADE_EASE],
          `${selector} eases off the reference's two curves`,
        ).toContainEqual(options.ease);
      }
    }
  });

  it("presses without overshoot and flips state instantly", () => {
    // The click gesture: 0.9 down, back to 1, nothing past 1. The state flip
    // is a near zero duration opacity swap, because state changes are
    // instant and only appearances animate.
    expect(FLIP_SECONDS).toBeLessThanOrEqual(0.02);
    for (const step of STEPS) {
      for (const [selector, keyframes] of segments(step)) {
        const scale = keyframes.scale;
        const values = Array.isArray(scale) ? scale : scale === undefined ? [] : [scale];
        for (const value of values) {
          if (selector === ANIM.ripple) continue;
          expect(value as number, `${selector} overshoots`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("fires the ripple as the spec draws it", () => {
    for (const step of [1, 2] as const) {
      const ripple = segments(step).find(([selector]) => selector === ANIM.ripple);
      expect(ripple, `step ${step} has no ripple`).toBeDefined();
      expect(ripple?.[1]).toEqual({ scale: [0.4, 2.4], opacity: [0.5, 0] });
      expect(ripple?.[2]?.duration).toBe(0.4);
    }
  });

  it("staggers the menu rows by the house interval", () => {
    // Three row segments, 0.05s apart, instead of a stagger() helper: the
    // installed motion build ships stagger untyped, and three explicit times
    // are also what the storyboard table actually says.
    const rows = segments(2).filter(([selector]) => selector.includes("menu-row"));
    expect(rows.length).toBe(3);
    const starts = rows
      .map(([, , options]) => options?.at as number)
      .sort((a, b) => a - b);
    expect(starts[1] - starts[0]).toBeCloseTo(0.05, 5);
    expect(starts[2] - starts[1]).toBeCloseTo(0.05, 5);
  });

  it("enters each step by fading the canvas on the fade curve", () => {
    for (const step of STEPS) {
      const canvas = segments(step).find(([selector]) => selector === ANIM.canvas);
      expect(canvas, `step ${step} never shows its canvas`).toBeDefined();
      expect(canvas?.[1]).toEqual({ opacity: [0, 1] });
      expect(canvas?.[2]).toEqual({ duration: ENTRY_SECONDS, ease: FADE_EASE, at: 0 });
    }
  });
});
