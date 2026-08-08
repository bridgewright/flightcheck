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
  CLOSING_LINGER_S,
  INITIAL_SILENCE_STATE,
  RESPONSE_DEBOUNCE_S,
  SILENCE_STAGES,
  STALL_BLIP_MAX_S,
  SUSPEND_GAP_S,
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

// --- Invariants ----------------------------------------------------------
//
// Each checker re-derives what the clock owes the candidate straight from
// the product rules, then compares that against what the reducer actually
// did. They are deliberately NOT a copy of the reducer: a second reading of
// the same spec is what makes a disagreement worth investigating.

export interface Violation {
  /** I1…I6 — the invariant that broke. */
  invariant: string;
  /** Index into the scenario's tick list, so a failure names its moment. */
  tickIndex: number;
  message: string;
}

/** How a tick is classified by the clock's rules, in precedence order. */
type TickKind = "suspend" | "interviewer" | "candidate" | "quiet";

function classify(t: SilenceTick): TickKind {
  if (t.dtS >= SUSPEND_GAP_S) return "suspend";
  if (t.interviewerAudible) return "interviewer";
  if (t.candidateAudible) return "candidate";
  return "quiet";
}

/**
 * Spec-side model of a quiet stretch and a pending response, advanced tick
 * by tick alongside the reducer.
 *
 * The one subtlety worth naming: a commit's debounce is measured from the
 * commit, so the tick that CARRIES the commit contributes nothing to it —
 * the audio in that interval was the utterance the commit closes, not the
 * room going quiet.
 */
interface Shadow {
  quietS: number;
  episodeS: number;
  stagesFired: number;
  armedAtIndex: number | null;
  quietSinceCommitS: number;
  triggeredForArm: boolean;
}

function freshShadow(): Shadow {
  return {
    quietS: 0,
    episodeS: 0,
    stagesFired: 0,
    armedAtIndex: null,
    quietSinceCommitS: 0,
    triggeredForArm: false,
  };
}

function checkTrace(run: ScenarioRun): Violation[] {
  const violations: Violation[] = [];
  const s = freshShadow();
  let closingQuietS = 0;
  let endEffects = 0;
  const add = (invariant: string, tickIndex: number, message: string) =>
    violations.push({ invariant, tickIndex, message });

  for (const step of run.steps) {
    const { index, tick: t, after, effects } = step;
    const kind = classify(t);
    const carriedCommit = t.commitArrived && kind !== "suspend";

    if (after.closingSeen) {
      if (t.candidateAudible || t.interviewerAudible) closingQuietS = 0;
      else if (t.dtS < SUSPEND_GAP_S && !step.before.interviewEnded) {
        closingQuietS += t.dtS;
      }
      if (effects.stage || effects.triggerResponse) {
        add("I7", index, "a response fired after closingSeen");
      }
      if (effects.endInterview) {
        endEffects += 1;
        if (closingQuietS + 1e-9 < CLOSING_LINGER_S) {
          add("I8", index, `end fired after only ${closingQuietS.toFixed(2)} s of full quiet`);
        }
      }
      if (endEffects > 1) add("I8", index, "endInterview fired more than once");
      continue;
    }

    if (carriedCommit) {
      s.armedAtIndex = index;
      s.quietSinceCommitS = 0;
      s.triggeredForArm = false;
    }

    switch (kind) {
      case "suspend":
        Object.assign(s, freshShadow());
        break;
      case "interviewer":
        s.episodeS = 0;
        break;
      case "candidate":
        s.episodeS += t.dtS;
        s.armedAtIndex = null;
        if (s.episodeS >= STALL_BLIP_MAX_S) {
          s.quietS = 0;
          s.stagesFired = 0;
        }
        break;
      case "quiet":
        s.episodeS = 0;
        s.quietS += t.dtS;
        if (s.armedAtIndex !== null && !carriedCommit) {
          s.quietSinceCommitS += t.dtS;
        }
        break;
    }

    // --- I1: staged scaffolds ------------------------------------------
    if (effects.stage) {
      const fired = effects.stage;
      const expected = SILENCE_STAGES[s.stagesFired];
      if (kind !== "quiet") {
        add("I1", index, `stage ${fired.at} fired on a ${kind} tick`);
      }
      if (expected === undefined || fired.at !== expected.at) {
        add(
          "I1",
          index,
          `stage ${fired.at} fired out of order (expected ` +
            `${expected?.at ?? "no further stage"} next in this stretch)`,
        );
      } else if (s.quietS < expected.at) {
        add(
          "I1",
          index,
          `stage ${fired.at} fired at only ${s.quietS.toFixed(2)} s of quiet`,
        );
      }
      s.stagesFired += 1;
    } else if (kind === "quiet" && s.stagesFired < SILENCE_STAGES.length) {
      const due = SILENCE_STAGES[s.stagesFired];
      if (s.quietS >= due.at) {
        add(
          "I1",
          index,
          `stage ${due.at} was due at ${s.quietS.toFixed(2)} s of quiet but ` +
            "the clock stayed silent",
        );
        // Do not re-report the same stuck stage on every later tick.
        s.stagesFired += 1;
      }
    }

    // --- I2: trigger provenance ----------------------------------------
    if (effects.triggerResponse) {
      if (s.armedAtIndex === null) {
        add("I2", index, "triggerResponse fired with no commit pending");
      } else if (s.triggeredForArm) {
        add(
          "I2",
          index,
          `triggerResponse fired twice for the commit at tick ${s.armedAtIndex}`,
        );
      } else if (s.quietSinceCommitS + 1e-9 < RESPONSE_DEBOUNCE_S) {
        add(
          "I2",
          index,
          `triggerResponse fired after only ` +
            `${s.quietSinceCommitS.toFixed(3)} s of quiet since the commit at ` +
            `tick ${s.armedAtIndex} (debounce is ${RESPONSE_DEBOUNCE_S} s)`,
        );
      }
      if (kind !== "quiet") {
        add("I2", index, `triggerResponse fired on a ${kind} tick`);
      }
      s.triggeredForArm = true;
      s.armedAtIndex = null;
    } else if (
      kind === "quiet" &&
      effects.stage === null &&
      s.armedAtIndex !== null &&
      s.quietSinceCommitS >= RESPONSE_DEBOUNCE_S
    ) {
      add(
        "I2",
        index,
        `the commit at tick ${s.armedAtIndex} went unanswered after ` +
          `${s.quietSinceCommitS.toFixed(3)} s of quiet`,
      );
      s.armedAtIndex = null;
    }

    // A scaffold carries its own response.create, so it consumes any pending
    // debounce. This runs AFTER the I2 checks on purpose: clearing it first
    // made every tick that fired both effects look like a response with no
    // commit behind it — the checker's own bug, not the clock's.
    if (effects.stage) s.armedAtIndex = null;
  }

  return violations;
}

function checkPerTick(run: ScenarioRun): Violation[] {
  const violations: Violation[] = [];
  const add = (invariant: string, tickIndex: number, message: string) =>
    violations.push({ invariant, tickIndex, message });

  for (const step of run.steps) {
    const { index, tick: t, before, after, effects } = step;
    const acted = effects.stage !== null || effects.triggerResponse;
    const what = effects.stage
      ? `stage ${effects.stage.at}`
      : "triggerResponse";

    // I2 — one tick asks Morgan to speak at most once.
    if (effects.stage !== null && effects.triggerResponse) {
      add(
        "I2",
        index,
        `stage ${effects.stage.at} and a response trigger fired on one tick`,
      );
    }
    // I3 — never speak over the candidate.
    if (t.candidateAudible && acted) {
      add("I3", index, `${what} fired while the candidate was audible`);
    }
    // I4 — never speak over the interviewer.
    if (t.interviewerAudible && acted) {
      add("I4", index, `${what} fired while the interviewer was audible`);
    }
    // I5 — a suspension gap is absence, not silence.
    if (t.dtS >= SUSPEND_GAP_S && !after.closingSeen) {
      if (acted) {
        add("I5", index, `${what} fired on a ${t.dtS.toFixed(2)} s gap tick`);
      }
      if (
        after.quietS !== 0 ||
        after.episodeS !== 0 ||
        after.stagesSent !== 0 ||
        after.responseDueInS !== null
      ) {
        add(
          "I5",
          index,
          `a ${t.dtS.toFixed(2)} s gap left the clock at ` +
            JSON.stringify(after),
        );
      }
    }
    // I6 — bounds, and a reducer that is genuinely a function.
    if (!Number.isFinite(after.quietS) || after.quietS < 0) {
      add("I6", index, `quietS out of bounds: ${after.quietS}`);
    }
    if (!Number.isFinite(after.episodeS) || after.episodeS < 0) {
      add("I6", index, `episodeS out of bounds: ${after.episodeS}`);
    }
    if (
      !Number.isInteger(after.stagesSent) ||
      after.stagesSent < 0 ||
      after.stagesSent > SILENCE_STAGES.length
    ) {
      add("I6", index, `stagesSent out of bounds: ${after.stagesSent}`);
    }
    if (
      after.responseDueInS !== null &&
      !(after.responseDueInS > 0 && after.responseDueInS <= RESPONSE_DEBOUNCE_S)
    ) {
      add("I6", index, `responseDueInS out of bounds: ${after.responseDueInS}`);
    }
    // Purity: same input, same output — no hidden state, no clock reads.
    const replay = nextSilenceState(before, t);
    if (
      JSON.stringify(replay.state) !== JSON.stringify(after) ||
      JSON.stringify(replay.effects) !== JSON.stringify(effects)
    ) {
      add("I6", index, "replaying the same tick produced a different result");
    }
  }

  return violations;
}

/** Every invariant, over a whole scenario. Empty means clean. */
export function checkInvariants(run: ScenarioRun): Violation[] {
  return [...checkPerTick(run), ...checkTrace(run)].sort(
    (a, b) => a.tickIndex - b.tickIndex,
  );
}

/** One-line-per-violation summary for an assertion message. */
export function describeViolations(violations: Violation[]): string {
  return violations
    .slice(0, 8)
    .map((v) => `  ${v.invariant} @tick ${v.tickIndex}: ${v.message}`)
    .join("\n");
}

// --- Seeded generation ---------------------------------------------------

/**
 * mulberry32 — a 32-bit PRNG small enough to read in one sitting. Every
 * generated scenario is a pure function of its seed, so a failure found on
 * seed 12345 replays exactly, forever, on any machine.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)];

const intBetween = (rng: () => number, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

/** Tick lengths a real ticker produces, including the pathological ones. */
const DT_CHOICES = [0.25, 0.25, 0.25, 0.25, 0.05, 0.5, 1.0, 1.9, 2.0, 2.1, 60];

export type Generator = (rng: () => number, length: number) => SilenceTick[];

/**
 * Rapid VAD flapping: the candidate's voice detector chattering on and off
 * across a range of duty cycles — the shape of breathy speech, a bad mic
 * gate, or fillers, where an off-by-one in episode accounting shows up.
 */
const vadFlapping: Generator = (rng, length) => {
  const ticks: SilenceTick[] = [];
  while (ticks.length < length) {
    const audible = rng() < 0.5;
    const run = intBetween(rng, 1, audible ? 12 : 40);
    for (let i = 0; i < run && ticks.length < length; i += 1) {
      ticks.push(tick({ candidateAudible: audible }));
    }
  }
  return ticks;
};

/** Bursts of commits, including commits landing on audible ticks. */
const commitStorms: Generator = (rng, length) => {
  const ticks: SilenceTick[] = [];
  while (ticks.length < length) {
    if (rng() < 0.15) {
      const burst = intBetween(rng, 1, 10);
      for (let i = 0; i < burst && ticks.length < length; i += 1) {
        ticks.push(
          commitTick({
            candidateAudible: rng() < 0.3,
            interviewerAudible: rng() < 0.2,
          }),
        );
      }
    } else {
      const gap = intBetween(rng, 1, 30);
      for (let i = 0; i < gap && ticks.length < length; i += 1) {
        ticks.push(tick());
      }
    }
  }
  return ticks;
};

/** Commit flags that arrive dropped, duplicated, or unattached to speech. */
const commitFlagNoise: Generator = (rng, length) =>
  Array.from({ length }, () =>
    tick({
      candidateAudible: rng() < 0.25,
      commitArrived: rng() < 0.1,
    }),
  );

/**
 * Interviewer audio with candidate audibility overlapping it in every
 * arrangement: echo that dies with the audio, echo that outlives it, and a
 * genuine barge-in that starts mid-utterance and keeps going.
 */
const overlapPatterns: Generator = (rng, length) => {
  const ticks: SilenceTick[] = [];
  while (ticks.length < length) {
    const morganRun = intBetween(rng, 2, 40);
    const echoStart = intBetween(rng, 0, morganRun);
    const outlive = intBetween(rng, 0, 16);
    for (let i = 0; i < morganRun && ticks.length < length; i += 1) {
      ticks.push(
        tick({
          interviewerAudible: true,
          candidateAudible: i >= echoStart,
        }),
      );
    }
    for (let i = 0; i < outlive && ticks.length < length; i += 1) {
      ticks.push(tick({ candidateAudible: true }));
    }
    const quiet = intBetween(rng, 0, 50);
    for (let i = 0; i < quiet && ticks.length < length; i += 1) {
      ticks.push(tick({ commitArrived: i === 0 && rng() < 0.4 }));
    }
  }
  return ticks;
};

/** Tick lengths jumping between normal, jittery and suspended. */
const dtSpikes: Generator = (rng, length) =>
  Array.from({ length }, () =>
    tick({
      dtS: pick(rng, DT_CHOICES),
      candidateAudible: rng() < 0.2,
      interviewerAudible: rng() < 0.2,
      commitArrived: rng() < 0.05,
    }),
  );

/** Closing sentinel followed by hostile goodbye overlap and commit noise. */
const closingPhases: Generator = (rng, length) =>
  Array.from({ length }, (_, index) =>
    tick({
      elapsedS: 1080 + index * TICK_S,
      finishedTranscript: index === 0 ? "Good luck out there." : null,
      candidateAudible: index > 0 && rng() < 0.15,
      interviewerAudible: index > 0 && rng() < 0.2,
      commitArrived: index > 0 && rng() < 0.1,
    }),
  );

/** Everything at once, for long runs. */
const soup: Generator = (rng, length) => {
  const parts: SilenceTick[] = [];
  const makers = [
    vadFlapping,
    commitStorms,
    commitFlagNoise,
    overlapPatterns,
    dtSpikes,
    // closingPhases is deliberately absent: closingSeen is terminal, and
    // folding it into the soup let one early latch skip the invariants
    // for every remaining tick (measured: 85% of a 5,000-tick run).
    // The standalone closingPhases rounds cover the closing state.
  ];
  while (parts.length < length) {
    const maker = pick(rng, makers);
    parts.push(...maker(rng, intBetween(rng, 20, 200)));
  }
  return parts.slice(0, length);
};

export const GENERATORS: Record<string, Generator> = {
  vadFlapping,
  commitStorms,
  commitFlagNoise,
  overlapPatterns,
  dtSpikes,
  closingPhases,
  soup,
};

export const GENERATOR_NAMES = Object.keys(GENERATORS);

/** Build a scenario reproducibly from a generator name and a seed. */
export function generate(
  name: string,
  seed: number,
  length = 800,
): SilenceTick[] {
  const maker = GENERATORS[name];
  if (!maker) throw new Error(`unknown generator: ${name}`);
  return maker(mulberry32(seed), length);
}

// --- Wire fuzzing --------------------------------------------------------

/**
 * Payloads a data channel should never send but might: truncated frames,
 * wrong types, prototype-pollution shapes, and strings large enough to make
 * a careless parser the reason an interview ended.
 */
export function hostileWirePayloads(rng: () => number, count = 200): string[] {
  const types = [
    "input_audio_buffer.speech_started",
    "input_audio_buffer.speech_stopped",
    "input_audio_buffer.committed",
    "output_audio_buffer.started",
    "output_audio_buffer.stopped",
    "response.done",
    "error",
  ];
  const fixed = [
    "",
    " ",
    "not json",
    "{",
    "[]",
    "null",
    "0",
    "true",
    '"just a string"',
    "{}",
    '{"type":null}',
    '{"type":123}',
    '{"type":{"nested":"object"}}',
    '{"type":["input_audio_buffer.committed"]}',
    '{"type":"input_audio_buffer.committed","item_id":null}',
    '{"type":"input_audio_buffer.committed","item_id":42}',
    '{"type":"input_audio_buffer.committed","item_id":{"toString":"nope"}}',
    '{"type":"input_audio_buffer.committed"}',
    '{"__proto__":{"polluted":true},"type":"input_audio_buffer.committed","item_id":"x"}',
    '{"constructor":{"prototype":{"polluted":true}},"type":"response.done"}',
    `{"type":"${"a".repeat(50_000)}"}`,
    `{"type":"input_audio_buffer.committed","item_id":"${"i".repeat(50_000)}"}`,
    `{"type":"response.done","deep":${"[".repeat(200)}${"]".repeat(200)}}`,
  ];
  const out = [...fixed];
  while (out.length < count) {
    const roll = rng();
    if (roll < 0.3) {
      out.push(JSON.stringify({ type: pick(rng, types) }));
    } else if (roll < 0.5) {
      out.push(
        JSON.stringify({ type: pick(rng, types), item_id: rng().toString(36) }),
      );
    } else if (roll < 0.7) {
      // A valid payload cut off mid-frame, the way a closing socket does it.
      const whole = JSON.stringify({
        type: pick(rng, types),
        item_id: "item_x",
      });
      out.push(whole.slice(0, intBetween(rng, 0, whole.length)));
    } else {
      out.push(String.fromCharCode(...Array.from({ length: 24 }, () => intBetween(rng, 1, 0x2f))));
    }
  }
  return out.slice(0, count);
}
