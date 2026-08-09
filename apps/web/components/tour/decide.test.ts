import { describe, expect, it } from "vitest";

import { decideBack, decideKey, decideNext, decideSkip } from "./decide";
import { initialState, visibleSteps, type TourState } from "./steps";

const FOUR = visibleSteps(["nav-sessions", "nav-progress", "nav-rubric", "primary-action"]);
const ONE = visibleSteps(["primary-action"]);

/** Every position a reader can be in, on both shapes of home. */
function positions(steps: readonly unknown[]): TourState[] {
  return steps.map((_, index) => ({ index, finished: false }));
}

describe("the once-flag is written exactly when the tour ends", () => {
  // This property is why the module exists. The four dismissal paths used to
  // call the storage helper themselves, and nothing tested them: a reviewer
  // deleted the call from Escape, from Skip, and added one to the no-anchor
  // path, and all three mutations kept the suite green. Deciding here makes
  // the rule checkable, and the component keeps a single write site.
  it("never claims a flag write without also ending the tour", () => {
    for (const steps of [ONE, FOUR]) {
      for (const state of positions(steps)) {
        const outcomes = [
          decideNext(state, steps),
          decideBack(state),
          decideSkip(state),
          decideKey("Escape", state, steps),
          decideKey("ArrowRight", state, steps),
          decideKey("ArrowLeft", state, steps),
          decideKey("Tab", state, steps),
        ];
        for (const outcome of outcomes) {
          expect(
            outcome.markDone,
            `an outcome at index ${state.index} writes the flag without closing`,
          ).toBe(outcome.state === null);
        }
      }
    }
  });

  it("ends and writes on Skip from every step", () => {
    for (const state of positions(FOUR)) {
      expect(decideSkip(state)).toEqual({ state: null, markDone: true, handled: true });
    }
  });

  it("ends and writes on Escape from every step, including the first", () => {
    // The first step is the one that matters: someone who wants nothing to do
    // with the tour presses Escape immediately, and must not be shown it again.
    expect(decideKey("Escape", initialState(), FOUR)).toEqual({
      state: null,
      markDone: true,
      handled: true,
    });
    for (const state of positions(FOUR)) {
      expect(decideKey("Escape", state, FOUR).markDone).toBe(true);
    }
  });

  it("ends and writes on Next only from the last step", () => {
    for (const state of positions(FOUR)) {
      const last = state.index === FOUR.length - 1;
      const outcome = decideNext(state, FOUR);
      expect(outcome.markDone, `index ${state.index}`).toBe(last);
      expect(outcome.state, `index ${state.index}`).toEqual(
        last ? null : { index: state.index + 1, finished: false },
      );
    }
  });

  it("ends on the first Next when only one step is visible", () => {
    // The NoPackages home has no ticket and no progress section, so a single
    // anchor is a real arrival, and its only button says Done.
    expect(ONE).toHaveLength(1);
    expect(decideNext(initialState(), ONE)).toEqual({
      state: null,
      markDone: true,
      handled: true,
    });
  });
});

describe("navigation moves without ending", () => {
  it("steps back without writing the flag, and holds at the first step", () => {
    expect(decideBack({ index: 2, finished: false })).toEqual({
      state: { index: 1, finished: false },
      markDone: false,
      handled: true,
    });
    expect(decideBack(initialState())).toEqual({
      state: { index: 0, finished: false },
      markDone: false,
      handled: true,
    });
  });

  it("maps the arrow keys onto next and back", () => {
    const state = { index: 1, finished: false };
    expect(decideKey("ArrowRight", state, FOUR)).toEqual(decideNext(state, FOUR));
    expect(decideKey("ArrowLeft", state, FOUR)).toEqual(decideBack(state));
  });

  it("leaves every other key to the page", () => {
    // The listener is on the window, so consuming keys the tour has no use for
    // would break typing and tabbing everywhere behind it.
    for (const key of ["Tab", "Enter", " ", "a", "ArrowUp", "ArrowDown"]) {
      const outcome = decideKey(key, initialState(), FOUR);
      expect(outcome.handled, key).toBe(false);
      expect(outcome.markDone, key).toBe(false);
      expect(outcome.state, key).toEqual(initialState());
    }
  });
});
