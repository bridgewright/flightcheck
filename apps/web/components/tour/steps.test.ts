import { describe, expect, it } from "vitest";

import {
  TOUR_STEPS,
  advance,
  back,
  counterText,
  initialState,
  liveText,
  skip,
  visibleSteps,
} from "./steps";

describe("home tour steps", () => {
  it("filters absent anchors without changing the specified order", () => {
    expect(visibleSteps(["primary-action", "nav-sessions"])).toEqual([
      TOUR_STEPS[0],
      TOUR_STEPS[3],
    ]);
  });

  it("advances and backs within the visible steps", () => {
    const steps = visibleSteps(["nav-sessions", "nav-rubric", "primary-action"]);
    const one = initialState();
    const two = advance(one, steps);
    expect(two.index).toBe(1);
    expect(back(two).index).toBe(0);
    expect(back(one)).toEqual(one);
    expect(advance(advance(two, steps), steps).index).toBe(2);
  });

  it("marks skip as finished", () => {
    expect(skip(initialState()).finished).toBe(true);
  });

  it("formats visible and live counters against filtered steps", () => {
    const steps = visibleSteps(["nav-progress", "primary-action"]);
    expect(counterText(initialState(), steps)).toBe("1 / 2");
    expect(liveText(initialState(), steps)).toBe("Step 1 of 2.");
  });

  it("keeps every step within the requested copy register", () => {
    expect(TOUR_STEPS.map((step) => step.anchor)).toEqual([
      "nav-sessions",
      "nav-progress",
      "nav-rubric",
      "primary-action",
    ]);
    for (const step of TOUR_STEPS) {
      expect(step.copy, step.copy).not.toMatch(/[!–—]/);
      expect(step.copy.split(/[.!?](?:\s|$)/).filter(Boolean).length).toBeLessThanOrEqual(2);
    }
  });
});
