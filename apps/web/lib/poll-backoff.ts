// Pure timing for the wait-state poller (F-39). No DOM, no router: the
// component in components/PollRefresh.tsx stays a thin driver over this.
//
// The defect this fixes: PollRefresh re-fetched its server component every
// five seconds for as long as the tab stayed open, whatever the answer was.
// A package id that will never resolve — a malformed link, a package deleted
// under an open tab, a compile that failed permanently — cost one request
// every five seconds forever, from every abandoned tab.
//
// Two mechanisms, both bounded:
//   * backoff — the gap grows geometrically toward a ceiling, so a state
//     that is taking a long time is checked less often rather than never.
//   * a circuit breaker — after a total polling budget the poller stops
//     entirely rather than degrading to a slow leak.
//
// Stopping is safe because it is reversible: the component re-arms on the
// tab becoming visible again, so a user who comes back always gets a fresh
// check. What never resumes on its own is a background tab nobody is
// watching, which is precisely the traffic worth not sending.

/** Below this the poller is a spin loop, whatever the caller asked for. */
export const MIN_POLL_INTERVAL_MS = 1000;

/** The gap never grows past this — a live wait state stays responsive. */
export const POLL_MAX_INTERVAL_MS = 60_000;

/** Growth per attempt. Gentle on purpose: compiling and scoring finish in
 * tens of seconds, so the first few checks must stay close to the caller's
 * interval. */
export const POLL_BACKOFF_FACTOR = 1.5;

/** Total time a single run may spend polling before the breaker trips.
 * Ten minutes comfortably outlasts a healthy compile (~1 min) and a healthy
 * scoring run (~3 min); past it, waiting longer is not the answer. */
export const POLL_BUDGET_MS = 10 * 60_000;

export interface PollState {
  /** Polls already issued in this run. */
  attempts: number;
  /** Milliseconds this run has spent waiting between polls. */
  elapsedMs: number;
  /** True once the budget is spent: no further polls until re-armed. */
  tripped: boolean;
}

export const INITIAL_POLL_STATE: PollState = {
  attempts: 0,
  elapsedMs: 0,
  tripped: false,
};

export interface PollLimits {
  /** What the page asked for — the gap before the FIRST poll. */
  baseMs: number;
  maxMs?: number;
  factor?: number;
  budgetMs?: number;
}

function base(limits: PollLimits): number {
  return Number.isFinite(limits.baseMs)
    ? Math.max(MIN_POLL_INTERVAL_MS, limits.baseMs)
    : MIN_POLL_INTERVAL_MS;
}

/**
 * How long to wait before the next poll, or null when the breaker has
 * tripped and the caller should stop scheduling.
 */
export function pollDelayMs(
  state: PollState,
  limits: PollLimits,
): number | null {
  if (state.tripped) {
    return null;
  }
  const factor = limits.factor ?? POLL_BACKOFF_FACTOR;
  const ceiling = limits.maxMs ?? POLL_MAX_INTERVAL_MS;
  return Math.min(ceiling, Math.round(base(limits) * factor ** state.attempts));
}

/**
 * The state after one poll has fired. The delay that was just waited out is
 * what the budget is spent on — measuring scheduled time rather than wall
 * time keeps this pure, and a throttled tab that stretched a timer only ever
 * makes the poller more conservative than the budget promises, never less.
 */
export function afterPoll(state: PollState, limits: PollLimits): PollState {
  const delay = pollDelayMs(state, limits);
  if (delay === null) {
    return state;
  }
  const elapsedMs = state.elapsedMs + delay;
  return {
    attempts: state.attempts + 1,
    elapsedMs,
    tripped: elapsedMs >= (limits.budgetMs ?? POLL_BUDGET_MS),
  };
}

/** A fresh run. Used when the tab becomes visible again: a user who came
 * back is watching, so the next check happens at the page's own interval. */
export function rearmedPollState(): PollState {
  return { attempts: 0, elapsedMs: 0, tripped: false };
}

/**
 * The events that re-arm a tripped run, besides the tab becoming visible.
 *
 * Visibility alone is not enough to tell "someone is waiting on this" from
 * "this tab has been open since Tuesday": a foreground tab stays `visible`
 * for as long as the laptop is. Without this list, a scoring run that
 * outlasts the budget — which the v0.6 scoring semaphore makes more likely,
 * not less — would leave the page frozen on "scoring" with no way back
 * short of a manual reload, and PollRefresh renders nothing that could say
 * so.
 *
 * A person, then, rather than a clock: the first sign of one starts a fresh
 * run with a fresh budget. A tab nobody touches produces none of these and
 * stays stopped, which is the whole point of the breaker.
 *
 * Chosen to be the cheapest reliable evidence of a human. `scroll` and
 * `mousemove` are excluded on purpose — they fire in bursts, and momentum
 * scrolling would re-arm long after the reader left.
 */
export const POLL_REARM_EVENTS: readonly string[] = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
];
