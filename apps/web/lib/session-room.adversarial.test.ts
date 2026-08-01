// Adversarial suite for the client-owned conversation clock.
//
// Part 1 of this file pins the five faults found live on 2026-08-01 as named
// regression scenarios. Four of them were fixed in the wiring or the session
// config; this file states what the PURE layer must do so a later refactor
// cannot quietly undo them.

import { describe, expect, it } from "vitest";

import {
  RESPONSE_DEBOUNCE_S,
  SILENCE_STAGES,
  STALL_BLIP_MAX_S,
  SUSPEND_GAP_S,
  committedItemId,
  indicatorForEvent,
  interviewerStateForEvent,
  speechStateForEvent,
  tickDeltaS,
} from "./session-room";
import {
  GENERATOR_NAMES,
  candidateTicks,
  checkInvariants,
  commitTick,
  describeViolations,
  generate,
  hostileWirePayloads,
  interviewerTicks,
  mulberry32,
  overlapTicks,
  quietTicks,
  runScenario,
  TICK_S,
  tick,
} from "./session-room-adversarial";

const STAGE_AT = SILENCE_STAGES.map((s) => s.at);

describe("seed ①: echo chain (speaker leak into the mic)", () => {
  // Live fault: with open speakers, Morgan's own voice re-entered the mic,
  // server VAD committed it as a candidate turn, and the client armed a
  // response to it — Morgan answering Morgan. The wiring now suppresses the
  // commit (ECHO_START_WINDOW_MS / ECHO_OUTLIVE_MS in SessionRoom.tsx), so
  // what the reducer sees is an audible episode with no commit behind it.
  it("a short echo episode neither arms a response nor fires a stage", () => {
    const run = runScenario([
      ...quietTicks(6),
      ...interviewerTicks(0.5),
      ...overlapTicks(1.5),
      ...interviewerTicks(0.25),
    ]);
    expect(run.triggers).toBe(0);
    expect(run.stagesFired).toEqual([]);
  });

  it("the quiet stretch resumes across the echo instead of restarting", () => {
    // 6 s of quiet, an echo, then 2 s more quiet: stage 1 (8 s) must fire —
    // if the echo had reset the stretch the stuck candidate would wait 8 s
    // more for the reassurance they already needed.
    const run = runScenario([
      ...quietTicks(6),
      ...interviewerTicks(0.5),
      ...overlapTicks(1.5),
      ...interviewerTicks(0.25),
      ...quietTicks(2),
    ]);
    expect(run.stagesFired).toEqual([STAGE_AT[0]]);
  });

  it("an echo lasting Morgan's whole utterance still does not reset the stretch", () => {
    // Morgan speaks for 3 s and the speakers leak the whole utterance back
    // into the mic, so the "episode" outlives STALL_BLIP_MAX_S. It is still
    // not the candidate speaking: the stretch must resume, not restart.
    const run = runScenario([
      ...quietTicks(6),
      ...interviewerTicks(0.5),
      ...overlapTicks(3),
      ...interviewerTicks(0.5),
      ...quietTicks(2),
    ]);
    expect(run.stagesFired).toEqual([STAGE_AT[0]]);
  });

  it("the scaffold ladder escalates across the echo of its own scaffold", () => {
    // The product failure this protects: stage 1 fires, Morgan says "Take
    // your time", the speakers leak it back, the stretch restarts — and a
    // candidate who stays stuck hears "Take your time" again and again
    // instead of the directional hint stage 2 owes them.
    const run = runScenario([
      ...quietTicks(8),
      ...interviewerTicks(0.5),
      ...overlapTicks(3),
      ...interviewerTicks(0.5),
      ...quietTicks(7),
    ]);
    expect(run.stagesFired).toEqual([STAGE_AT[0], STAGE_AT[1]]);
  });

  it("a real barge-in still resets the stretch once Morgan stops", () => {
    // The other side of the same rule: echo dies with Morgan's audio, a
    // candidate who talks over him keeps going. Once he is quiet the
    // episode is unambiguous speech and must reset the stretch.
    const run = runScenario([
      ...quietTicks(6),
      ...overlapTicks(2),
      ...candidateTicks(STALL_BLIP_MAX_S + 0.5),
      ...quietTicks(7),
    ]);
    expect(run.stagesFired).toEqual([]);
    expect(run.finalState.quietS).toBeCloseTo(7, 5);
  });
});

describe("seed ②: single-signal dependence (dropped VAD events)", () => {
  // Live fault: the clock depended on one signal source, and when that
  // source went quiet the whole machinery went inert — Morgan never spoke
  // again after the greeting. The reducer must therefore not require a
  // speech_started/stopped pair before it will act on a commit.
  it("a commit with no preceding speech ticks still arms the response", () => {
    const run = runScenario([
      ...quietTicks(3),
      commitTick(),
      ...quietTicks(RESPONSE_DEBOUNCE_S + 0.5),
    ]);
    expect(run.triggers).toBe(1);
  });

  it("interviewer audibility pauses the clock whichever tick reports it", () => {
    const run = runScenario([
      ...quietTicks(7),
      ...interviewerTicks(5),
      ...quietTicks(1),
    ]);
    // Quiet stayed paused at 7 s through the interviewer's 5 s of audio, so
    // stage 1 lands 1 s after the room goes quiet again, not during it.
    expect(run.stagesFired).toEqual([STAGE_AT[0]]);
    expect(
      run.steps.filter((s) => s.tick.interviewerAudible && s.effects.stage),
    ).toEqual([]);
  });

  it("both interviewer sources map to the same audible signal", () => {
    // The OR of analyser peak and server events lives in the ticker, which
    // cannot be exercised purely; what IS pure is the event mapping that
    // feeds the second source — pin that both lifecycle events and the
    // response.done activation gate survive.
    const mk = (type: string) => JSON.stringify({ type });
    expect(interviewerStateForEvent(mk("output_audio_buffer.started"))).toBe(
      "speaking",
    );
    expect(interviewerStateForEvent(mk("output_audio_buffer.stopped"))).toBe(
      "quiet",
    );
    expect(interviewerStateForEvent(mk("response.done"))).toBe("response_done");
    expect(speechStateForEvent(mk("input_audio_buffer.committed"))).toBe(
      "committed",
    );
  });
});

describe("seed ③: background-tab throttling burst", () => {
  // A candidate whose tab is backgrounded has stepped away from the
  // interview. Browsers deliver the parked time either as one giant-dt tick
  // or as a burst of queued ticks; both used to fast-forward the quiet clock
  // and empty the whole scaffold ladder into the candidate's ear the moment
  // they came back. Morgan resumes quietly instead, as a human would after
  // glancing up.
  it("a minute-long gap fires no scaffolds on the way back", () => {
    const run = runScenario([
      ...quietTicks(6),
      tick({ dtS: 60 }),
      ...quietTicks(5),
    ]);
    expect(run.stagesFired).toEqual([]);
    expect(run.triggers).toBe(0);
  });

  it("the gap tick itself produces no effects and resets the stretch", () => {
    const run = runScenario([...quietTicks(6), tick({ dtS: 60 })]);
    const gap = run.steps[run.steps.length - 1];
    expect(gap.effects).toEqual({ stage: null, triggerResponse: false });
    expect(gap.after).toEqual({
      quietS: 0,
      episodeS: 0,
      stagesSent: 0,
      responseDueInS: null,
    });
  });

  it("a response armed before the gap is dropped, not fired on return", () => {
    const run = runScenario([
      commitTick(),
      tick({ dtS: 60 }),
      ...quietTicks(5),
    ]);
    expect(run.triggers).toBe(0);
  });

  it("the ladder starts over from the resumed quiet stretch", () => {
    const preGap = quietTicks(20);
    const run = runScenario([...preGap, tick({ dtS: 45 }), ...quietTicks(8)]);
    // The candidate earned stages 1 and 2 before stepping away. On return
    // the ladder restarts at stage 1 rather than continuing to stage 3 —
    // the reassurance fits a fresh silence, which is what this now is.
    expect(run.stagesFired).toEqual([STAGE_AT[0], STAGE_AT[1], STAGE_AT[0]]);
    // And it lands a full 8 s after the resume, not on the way back in.
    const resumed = run.steps.slice(preGap.length + 1);
    const firstStageAfter = resumed.findIndex((s) => s.effects.stage !== null);
    expect(firstStageAfter * TICK_S).toBeCloseTo(STAGE_AT[0] - TICK_S, 5);
  });

  it("a stage already due before the gap is not replayed after it", () => {
    const run = runScenario([
      ...quietTicks(8),
      tick({ dtS: 60 }),
      ...quietTicks(7.75),
    ]);
    expect(run.stagesFired).toEqual([STAGE_AT[0]]);
  });

  it("treats the gap threshold as a boundary, not a range", () => {
    const below = runScenario([
      ...quietTicks(7),
      tick({ dtS: SUSPEND_GAP_S - 0.01 }),
    ]);
    expect(below.stagesFired).toEqual([STAGE_AT[0]]);
    const atGap = runScenario([...quietTicks(7), tick({ dtS: SUSPEND_GAP_S })]);
    expect(atGap.stagesFired).toEqual([]);
    expect(atGap.finalState.quietS).toBe(0);
  });

  it("derives tick length from the wall clock so a queued burst is one gap", () => {
    // The reducer can only see a suspension if the ticker stops assuming
    // its own 250 ms interval: a refocus burst delivers many callbacks in
    // the same real second, and only a wall-clock delta reports that as one
    // large tick followed by normal ones.
    expect(tickDeltaS(1_000, 750)).toBeCloseTo(0.25, 6);
    expect(tickDeltaS(61_000, 1_000)).toBeCloseTo(60, 6);
    const burst = [61_000, 61_001, 61_002, 61_003];
    const deltas = burst.map((now, i) =>
      tickDeltaS(now, i === 0 ? 1_000 : burst[i - 1]),
    );
    expect(deltas[0]).toBeGreaterThanOrEqual(SUSPEND_GAP_S);
    expect(deltas.slice(1).every((d) => d < SUSPEND_GAP_S)).toBe(true);
  });

  it("never reports a negative or non-finite tick length", () => {
    expect(tickDeltaS(500, 900)).toBe(0);
    expect(tickDeltaS(Number.NaN, 100)).toBe(0);
    expect(tickDeltaS(100, Number.NaN)).toBe(0);
    expect(tickDeltaS(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

describe("seed ④: phantom noise commits", () => {
  // Live fault: room noise committed a turn with no speech in it, and the
  // client answered it. One commit must buy exactly one response — never a
  // second one from the same commit, and never a stack of them.
  it("one commit plus continuous quiet fires exactly one trigger", () => {
    const run = runScenario([
      commitTick(),
      ...quietTicks(RESPONSE_DEBOUNCE_S + 5),
    ]);
    expect(run.triggers).toBe(1);
  });

  it("a commit storm never stacks pending responses", () => {
    const run = runScenario([
      commitTick(),
      commitTick(),
      commitTick(),
      commitTick(),
      commitTick(),
      ...quietTicks(RESPONSE_DEBOUNCE_S + 5),
    ]);
    expect(run.triggers).toBe(1);
  });

  it("quiet alone never triggers a response without a commit", () => {
    const run = runScenario(quietTicks(40));
    expect(run.triggers).toBe(0);
    expect(run.stagesFired).toEqual(STAGE_AT);
  });

  it("the committed item id is read only from committed payloads", () => {
    expect(
      committedItemId(
        JSON.stringify({
          type: "input_audio_buffer.committed",
          item_id: "item_echo",
        }),
      ),
    ).toBe("item_echo");
    expect(
      committedItemId(JSON.stringify({ type: "input_audio_buffer.speech_stopped" })),
    ).toBeNull();
  });
});

describe("seed ⑤: onset truncation adjacency", () => {
  // Live fault: echo at utterance onset truncated Morgan's first words. The
  // config fix was interrupt_response: false; the pure invariant is that the
  // clock never acts on a tick where both sides are audible — whatever the
  // mic thinks it heard, the room is not quiet.
  it("overlapping audibility produces no effects at all", () => {
    const run = runScenario([
      ...quietTicks(7.5),
      ...overlapTicks(10),
      ...interviewerTicks(1),
    ]);
    const acted = run.steps.filter(
      (s) =>
        s.tick.candidateAudible &&
        s.tick.interviewerAudible &&
        (s.effects.stage !== null || s.effects.triggerResponse),
    );
    expect(acted).toEqual([]);
  });

  it("a pending response never fires while the room is not quiet", () => {
    const run = runScenario([
      commitTick(),
      ...overlapTicks(5),
      ...candidateTicks(STALL_BLIP_MAX_S + 1),
    ]);
    expect(run.triggers).toBe(0);
  });
});

// --- Part 3/4: generated adversarial rounds ------------------------------
//
// Every scenario below is a pure function of its seed: a failure here names
// the generator and the seed that produced it, and replays exactly.

const ROUND_SEEDS = [1, 7, 42, 1337, 20260801, 987654321];

describe("clock invariants under generated adversarial load", () => {
  for (const name of GENERATOR_NAMES) {
    for (const seed of ROUND_SEEDS) {
      it(`${name} holds I1-I6 (seed ${seed})`, () => {
        const run = runScenario(generate(name, seed));
        const violations = checkInvariants(run);
        expect(
          violations,
          `${name} seed=${seed} — ${violations.length} violation(s):\n` +
            describeViolations(violations),
        ).toEqual([]);
      });
    }
  }

  it("holds I1-I6 across a 5,000-tick soup of everything", () => {
    const run = runScenario(generate("soup", 20260801, 5_000));
    const violations = checkInvariants(run);
    expect(
      violations,
      `soup seed=20260801 — ${violations.length} violation(s):\n` +
        describeViolations(violations),
    ).toEqual([]);
  });
});

describe("wire helpers under hostile payloads", () => {
  const payloads = hostileWirePayloads(mulberry32(20260801), 300);

  it("never throw, whatever arrives on the data channel", () => {
    for (const raw of payloads) {
      expect(() => speechStateForEvent(raw)).not.toThrow();
      expect(() => interviewerStateForEvent(raw)).not.toThrow();
      expect(() => committedItemId(raw)).not.toThrow();
      expect(() => indicatorForEvent(raw)).not.toThrow();
    }
  });

  it("return only contract values or null", () => {
    const speech = new Set(["started", "stopped", "committed", null]);
    const morgan = new Set(["speaking", "quiet", "response_done", null]);
    for (const raw of payloads) {
      expect(speech.has(speechStateForEvent(raw))).toBe(true);
      expect(morgan.has(interviewerStateForEvent(raw))).toBe(true);
      const id = committedItemId(raw);
      expect(id === null || typeof id === "string").toBe(true);
      const indicator = indicatorForEvent(raw);
      expect(indicator === null || indicator === "listening").toBe(true);
    }
  });

  it("leave Object.prototype unpolluted", () => {
    for (const raw of payloads) {
      speechStateForEvent(raw);
      interviewerStateForEvent(raw);
      committedItemId(raw);
      indicatorForEvent(raw);
    }
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("only a well-formed committed payload yields an item id", () => {
    for (const raw of payloads) {
      const id = committedItemId(raw);
      if (id !== null) {
        expect(speechStateForEvent(raw)).toBe("committed");
      }
    }
  });
});

// --- Findings from the generated rounds ----------------------------------

describe("round finding: the debounce must be measured from the commit", () => {
  // Found by commitFlagNoise/commitStorms/soup on every seed tried: the tick
  // that CARRIES the commit was also credited as quiet-since-commit, so the
  // candidate got one tick less room to resume than RESPONSE_DEBOUNCE_S
  // promises. The audio in that interval is the tail of the utterance the
  // commit closes — it is not the room going quiet.
  it("does not count the tick that carried the commit", () => {
    const short = runScenario([commitTick(), ...quietTicks(1.0)]);
    expect(short.triggers).toBe(0);
    const full = runScenario([commitTick(), ...quietTicks(1.25)]);
    expect(full.triggers).toBe(1);
  });

  it("a long tick carrying a commit does not consume the debounce whole", () => {
    // The sharp case dtSpikes found: with a jittery 1.9 s tick the debounce
    // was spent the instant it was armed, and Morgan answered with zero
    // room for the candidate to keep going.
    const run = runScenario([commitTick({ dtS: 1.9 })]);
    expect(run.triggers).toBe(0);
    expect(run.steps[0].after.responseDueInS).toBeCloseTo(
      RESPONSE_DEBOUNCE_S,
      5,
    );
  });
});

describe("round finding: one tick, one thing to say", () => {
  // The generators produced ticks carrying BOTH a scaffold and a debounced
  // response. The wiring happened to send only the scaffold (its else-if),
  // so nothing misbehaved live — but that made a silent ordering detail in
  // the component the only thing standing between a candidate and two
  // response.create frames. The reducer now states it: a scaffold carries
  // its own response, so it supersedes the pending one.
  it("a scaffold and a debounced response never fire on the same tick", () => {
    const run = runScenario([
      ...quietTicks(6.5),
      commitTick(),
      ...quietTicks(1.25),
    ]);
    const both = run.steps.filter(
      (s) => s.effects.stage !== null && s.effects.triggerResponse,
    );
    expect(both).toEqual([]);
    expect(run.stagesFired).toEqual([STAGE_AT[0]]);
    expect(run.triggers).toBe(0);
  });
});
