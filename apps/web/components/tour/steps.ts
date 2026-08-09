export interface TourStep {
  readonly anchor: string;
  readonly copy: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    anchor: "nav-sessions",
    copy: "Press Sessions to review transcripts, per-answer coaching, and study notes.",
  },
  {
    anchor: "nav-progress",
    copy: "Press Progress to compare scores across sessions and see each scoring dimension.",
  },
  {
    anchor: "nav-rubric",
    copy: "Press Role & Rubric to see the bar you are scored against. It is compiled from your job description.",
  },
  {
    anchor: "primary-action",
    copy: "Press here to start your next session or unlock the package.",
  },
];

export interface TourState {
  readonly index: number;
  readonly finished: boolean;
}

export function visibleSteps(present: readonly string[]): readonly TourStep[] {
  const anchors = new Set(present);
  return TOUR_STEPS.filter((step) => anchors.has(step.anchor));
}

export function initialState(): TourState {
  return { index: 0, finished: false };
}

export function advance(state: TourState, steps: readonly TourStep[]): TourState {
  if (state.index >= steps.length - 1) return { ...state, finished: true };
  return { index: state.index + 1, finished: false };
}

export function back(state: TourState): TourState {
  if (state.index === 0) return state;
  return { index: state.index - 1, finished: false };
}

export function skip(state: TourState): TourState {
  return { ...state, finished: true };
}

export function counterText(state: TourState, steps: readonly TourStep[]): string {
  return `${state.index + 1} / ${steps.length}`;
}

export function liveText(state: TourState, steps: readonly TourStep[]): string {
  return `Step ${state.index + 1} of ${steps.length}.`;
}
