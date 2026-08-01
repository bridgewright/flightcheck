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
  committedItemId,
  interviewerStateForEvent,
  speechStateForEvent,
} from "./session-room";
import {
  candidateTicks,
  commitTick,
  interviewerTicks,
  overlapTicks,
  quietTicks,
  runScenario,
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
