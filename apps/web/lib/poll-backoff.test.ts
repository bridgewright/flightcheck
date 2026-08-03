import { describe, expect, it } from "vitest";

import {
  INITIAL_POLL_STATE,
  MIN_POLL_INTERVAL_MS,
  POLL_BACKOFF_FACTOR,
  POLL_BUDGET_MS,
  POLL_MAX_INTERVAL_MS,
  afterPoll,
  pollDelayMs,
  rearmedPollState,
  type PollState,
} from "./poll-backoff";

const limits = { baseMs: 5000 };

/** Drive the machine the way the component does: delay, poll, repeat. */
function run(
  baseMs: number,
  stopAfter = 200,
): { delays: number[]; state: PollState } {
  let state = INITIAL_POLL_STATE;
  const delays: number[] = [];
  for (let i = 0; i < stopAfter; i += 1) {
    const delay = pollDelayMs(state, { baseMs });
    if (delay === null) break;
    delays.push(delay);
    state = afterPoll(state, { baseMs });
  }
  return { delays, state };
}

describe("pollDelayMs", () => {
  it("waits the caller's base interval before the first poll", () => {
    expect(pollDelayMs(INITIAL_POLL_STATE, limits)).toBe(5000);
  });

  it("backs off geometrically as attempts accumulate", () => {
    const { delays } = run(5000, 4);
    expect(delays[0]).toBe(5000);
    expect(delays[1]).toBe(Math.round(5000 * POLL_BACKOFF_FACTOR));
    expect(delays[2]).toBe(Math.round(5000 * POLL_BACKOFF_FACTOR ** 2));
    expect(delays[3]).toBe(Math.round(5000 * POLL_BACKOFF_FACTOR ** 3));
  });

  it("never waits longer than the ceiling", () => {
    const { delays } = run(5000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(POLL_MAX_INTERVAL_MS);
    expect(delays.at(-1)).toBe(POLL_MAX_INTERVAL_MS);
  });

  it("floors a zero or negative interval so a caller cannot spin the tab", () => {
    // The whole defect being fixed is unbounded polling; an interval of 0
    // would be a tighter loop than the bug.
    expect(pollDelayMs(INITIAL_POLL_STATE, { baseMs: 0 })).toBe(
      MIN_POLL_INTERVAL_MS,
    );
    expect(pollDelayMs(INITIAL_POLL_STATE, { baseMs: -1 })).toBe(
      MIN_POLL_INTERVAL_MS,
    );
    expect(pollDelayMs(INITIAL_POLL_STATE, { baseMs: Number.NaN })).toBe(
      MIN_POLL_INTERVAL_MS,
    );
  });

  it("returns null once the breaker has tripped", () => {
    expect(pollDelayMs({ ...INITIAL_POLL_STATE, tripped: true }, limits)).toBe(
      null,
    );
  });
});

describe("afterPoll", () => {
  it("counts the attempt and the time it waited for it", () => {
    const state = afterPoll(INITIAL_POLL_STATE, limits);
    expect(state.attempts).toBe(1);
    expect(state.elapsedMs).toBe(5000);
    expect(state.tripped).toBe(false);
  });

  it("trips the breaker once the polling budget is spent", () => {
    const { state, delays } = run(5000);
    expect(state.tripped).toBe(true);
    // A malformed id that will never resolve stops costing requests. The
    // old component polled every 5s forever: ~120 requests in ten minutes.
    expect(delays.length).toBeLessThan(40);
    expect(state.elapsedMs).toBeGreaterThanOrEqual(POLL_BUDGET_MS);
  });

  it("honours a caller-supplied budget", () => {
    let state = INITIAL_POLL_STATE;
    const short = { baseMs: 5000, budgetMs: 12_000 };
    state = afterPoll(state, short); // 5s spent
    expect(state.tripped).toBe(false);
    state = afterPoll(state, short); // 12.5s spent
    expect(state.tripped).toBe(true);
    expect(pollDelayMs(state, short)).toBe(null);
  });

  it("stays tripped: a tripped state never resumes on its own", () => {
    const tripped: PollState = { attempts: 9, elapsedMs: 10_000, tripped: true };
    expect(afterPoll(tripped, limits)).toEqual(tripped);
  });
});

describe("rearmedPollState", () => {
  it("returns a fresh run, so a returning user always gets a live check", () => {
    expect(rearmedPollState()).toEqual(INITIAL_POLL_STATE);
  });

  it("is a new object, so React sees a state change after a trip", () => {
    expect(rearmedPollState()).not.toBe(INITIAL_POLL_STATE);
  });
});
