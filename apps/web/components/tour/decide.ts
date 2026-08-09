import { advance, back, skip, type TourState, type TourStep } from "./steps";

/**
 * What the tour does about one interaction.
 *
 * The once-flag write lives in this decision rather than at the call sites
 * that make it, so that "the flag is written exactly when the tour ends" is a
 * property a test can hold rather than a habit spread over four handlers.
 */
export interface TourOutcome {
  /** The state to render, or null once the tour is over. */
  readonly state: TourState | null;
  /** Whether the once-flag must be written. True only alongside a null state. */
  readonly markDone: boolean;
  /** Whether the tour consumed the event and the page should not also act. */
  readonly handled: boolean;
}

/** A moved-to state, or the ending it turned out to be. */
function reached(state: TourState): TourOutcome {
  return state.finished
    ? { state: null, markDone: true, handled: true }
    : { state, markDone: false, handled: true };
}

/** Next, which is Done on the last step. */
export function decideNext(state: TourState, steps: readonly TourStep[]): TourOutcome {
  return reached(advance(state, steps));
}

export function decideBack(state: TourState): TourOutcome {
  return reached(back(state));
}

/**
 * Skip and Escape are one decision. Both end the tour and both spend the
 * arrival: someone who dismissed it on the first step has been shown it, and
 * showing it again on the next visit is the thing DECISIONS 061 rules out.
 */
export function decideSkip(state: TourState): TourOutcome {
  return reached(skip(state));
}

export function decideKey(
  key: string,
  state: TourState,
  steps: readonly TourStep[],
): TourOutcome {
  if (key === "Escape") return decideSkip(state);
  if (key === "ArrowRight") return decideNext(state, steps);
  if (key === "ArrowLeft") return decideBack(state);
  // The listener sits on the window, so every other key has to pass through
  // untouched: Tab still moves focus and typing still reaches the page.
  return { state, markDone: false, handled: false };
}
