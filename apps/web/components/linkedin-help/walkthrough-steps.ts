// The step model and the copy for the LinkedIn PDF walkthrough (F-55).
//
// Pure on purpose: the popover component wires buttons to these functions and
// renders these strings, and everything that can be tested without a DOM is
// tested here. The interaction spec this implements is
// plans/dispatch/f55-walkthrough-spec.md.
//
// Text is the primary carrier of every instruction. The stage animation is
// reinforcement, is aria-hidden, and can be absent (reduced motion) without
// losing information, which is why every caption states the complete step.

export const STEP_COUNT = 3;

export type WalkthroughStep = 1 | 2 | 3;

export interface WalkthroughState {
  /** The step being read, 1 to STEP_COUNT. */
  readonly step: WalkthroughStep;
  /** Bumped to replay the current step's animation from t=0. The stage is
   * keyed by (step, runId), so a bump remounts it and the sequence plays
   * once again. */
  readonly runId: number;
}

export function initialState(): WalkthroughState {
  return { step: 1, runId: 0 };
}

/** Next. Clamped: at the last step the primary action is Done, never a
 * fourth step, and the component closes instead of calling this. */
export function advance(state: WalkthroughState): WalkthroughState {
  if (state.step >= STEP_COUNT) return state;
  return { step: (state.step + 1) as WalkthroughStep, runId: state.runId };
}

/** Back. Clamped at step 1, where the control is disabled rather than
 * hidden so the footer geometry never changes. */
export function back(state: WalkthroughState): WalkthroughState {
  if (state.step <= 1) return state;
  return { step: (state.step - 1) as WalkthroughStep, runId: state.runId };
}

/** Replay the current step's animation from the start. */
export function replay(state: WalkthroughState): WalkthroughState {
  return { step: state.step, runId: state.runId + 1 };
}

/** Back to step 1 with a fresh run. The component calls this on every open,
 * so a deliberate close then reopen is a fresh read (the mid-task case is
 * covered by never closing on tab switches in the first place). */
export function reset(state: WalkthroughState): WalkthroughState {
  return { step: 1, runId: state.runId + 1 };
}

export function canBack(state: WalkthroughState): boolean {
  return state.step > 1;
}

export function atEnd(state: WalkthroughState): boolean {
  return state.step === STEP_COUNT;
}

/** The one primary button, relabeled on the last step. Never a second
 * element: the same control changes its text, so the footer never reflows. */
export function primaryLabel(state: WalkthroughState): string {
  return atEnd(state) ? BUTTON_LABELS.done : BUTTON_LABELS.next;
}

/** The visible counter, aria-hidden in the footer. */
export function counterText(state: WalkthroughState): string {
  return `${state.step} / ${STEP_COUNT}`;
}

/** The screen reader's counter, announced by the live region so the visible
 * one can stay aria-hidden and nothing is announced twice. */
export function liveText(state: WalkthroughState): string {
  return `Step ${state.step} of ${STEP_COUNT}.`;
}

// --- Copy -----------------------------------------------------------------
//
// Exact strings from the interaction spec. The captions hedge the button
// name ("More, sometimes labeled Resources") because LinkedIn's own help
// hedges it, and the step 2 fine print is load bearing rather than polish:
// the export is unavailable to some members, so any profile PDF is accepted.

export const WALKTHROUGH_TITLE = "Export your profile from LinkedIn";

export const TRIGGER_LABEL = "How to export this PDF from LinkedIn";

export const CAPTIONS: Record<WalkthroughStep, string> = {
  1: "On LinkedIn, open your own profile, then click More, sometimes labeled Resources, in the box under your name.",
  2: "In the menu that opens, click Save to PDF. LinkedIn downloads your profile as a PDF file.",
  3: "Back in this tab, choose the downloaded file in the LinkedIn profile PDF field below.",
};

export const FINE_PRINTS: Record<WalkthroughStep, string> = {
  1: "Desktop only: the LinkedIn mobile app does not offer this.",
  2: "Can't find it? Any exported profile PDF works here.",
  3: "Prefer text? Paste your profile into the text box instead.",
};

export const BUTTON_LABELS = {
  back: "Back",
  next: "Next",
  done: "Done",
  replay: "Replay",
} as const;
