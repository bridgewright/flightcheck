// Adversarial harness for the client-owned conversation clock.
//
// The reducer in session-room.ts is the ONLY source of response.create and of
// every [silence status] scaffold, so a wrong tick sequence is heard by a real
// candidate as the interviewer talking over them, going mute, or repeating
// itself. On 2026-08-01 five such faults were found live, one at a time, from
// logs. This module makes that hunt repeatable: it replays hostile tick
// sequences against the pure reducer, checks spec-level invariants over the
// resulting trace, and generates fresh sequences from a seed so any failure
// can be reproduced exactly.
//
// Everything here is pure and dependency-free so the release gate can import
// it without a browser, a network, or a provider key.

import {
  INITIAL_SILENCE_STATE,
  nextSilenceState,
  type SilenceClockState,
  type SilenceEffects,
  type SilenceTick,
} from "./session-room";

/** The wiring's nominal tick interval (SessionRoom.tsx setInterval). */
export const TICK_S = 0.25;

export interface ScenarioStep {
  index: number;
  tick: SilenceTick;
  /** Clock state fed to the reducer (frozen — see runScenario). */
  before: SilenceClockState;
  after: SilenceClockState;
  effects: SilenceEffects;
}

export interface ScenarioRun {
  steps: ScenarioStep[];
  finalState: SilenceClockState;
  /** `at` seconds of every stage that fired, in fire order. */
  stagesFired: number[];
  /** Number of ticks that produced a triggerResponse. */
  triggers: number;
}

/**
 * Replay a tick sequence through the reducer, keeping every intermediate
 * state and effect so invariants can be checked against the whole trace.
 *
 * The input state and tick are frozen on every step: ES modules are strict
 * mode, so a reducer that mutated its input would throw here rather than
 * silently corrupting a scenario.
 */
export function runScenario(
  ticks: readonly SilenceTick[],
  initial: SilenceClockState = INITIAL_SILENCE_STATE,
): ScenarioRun {
  const steps: ScenarioStep[] = [];
  const stagesFired: number[] = [];
  let triggers = 0;
  let state = initial;

  for (const [index, rawTick] of ticks.entries()) {
    const before = Object.freeze({ ...state });
    const tick = Object.freeze({ ...rawTick });
    const { state: after, effects } = nextSilenceState(before, tick);
    steps.push({ index, tick, before, after, effects });
    if (effects.stage) stagesFired.push(effects.stage.at);
    if (effects.triggerResponse) triggers += 1;
    state = after;
  }

  return { steps, finalState: state, stagesFired, triggers };
}

// --- Tick builders -------------------------------------------------------

const BASE_TICK: SilenceTick = {
  dtS: TICK_S,
  candidateAudible: false,
  interviewerAudible: false,
  commitArrived: false,
};

export function tick(overrides: Partial<SilenceTick> = {}): SilenceTick {
  return { ...BASE_TICK, ...overrides };
}

function span(
  seconds: number,
  overrides: Partial<SilenceTick>,
  dtS: number = TICK_S,
): SilenceTick[] {
  return Array.from({ length: Math.round(seconds / dtS) }, () =>
    tick({ ...overrides, dtS }),
  );
}

/** Room quiet: neither side audible. */
export const quietTicks = (seconds: number, dtS: number = TICK_S) =>
  span(seconds, {}, dtS);

/** Candidate audible, interviewer silent. */
export const candidateTicks = (seconds: number, dtS: number = TICK_S) =>
  span(seconds, { candidateAudible: true }, dtS);

/** Interviewer audible, candidate silent. */
export const interviewerTicks = (seconds: number, dtS: number = TICK_S) =>
  span(seconds, { interviewerAudible: true }, dtS);

/** Both audible — a barge-in, or speaker echo the mic cannot tell from one. */
export const overlapTicks = (seconds: number, dtS: number = TICK_S) =>
  span(seconds, { candidateAudible: true, interviewerAudible: true }, dtS);

/** A single tick carrying an input_audio_buffer.committed. */
export const commitTick = (overrides: Partial<SilenceTick> = {}) =>
  tick({ ...overrides, commitArrived: true });
