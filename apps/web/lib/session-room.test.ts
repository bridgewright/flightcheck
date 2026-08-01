import { describe, expect, it } from "vitest";

import {
  HARD_CUT_S,
  INITIAL_SILENCE_STATE,
  RESPONSE_DEBOUNCE_S,
  SESSION_BUDGET_S,
  SILENCE_STAGES,
  SILENCE_STATUS_PREFIX,
  STALL_BLIP_MAX_S,
  TIME_STATUS_PREFIX,
  dueTimeStatus,
  formatTimer,
  greetingTriggerEvent,
  indicatorForEvent,
  interviewerStateForEvent,
  isHardCut,
  nextSilenceState,
  responseTriggerEvent,
  silenceStatusEvent,
  speechStateForEvent,
  timeStatusCheckpoints,
  timeStatusEvent,
  type SilenceClockState,
  type SilenceTick,
} from "./session-room";

describe("formatTimer", () => {
  it("formats zero", () => {
    expect(formatTimer(0)).toBe("00:00");
  });

  it("pads minutes and seconds", () => {
    expect(formatTimer(65)).toBe("01:05");
  });

  it("formats the 20:00 budget", () => {
    expect(formatTimer(SESSION_BUDGET_S)).toBe("20:00");
  });

  it("formats the 25:00 hard cut", () => {
    expect(formatTimer(HARD_CUT_S)).toBe("25:00");
  });

  it("clamps negative input to zero", () => {
    expect(formatTimer(-3)).toBe("00:00");
  });
});

describe("indicatorForEvent", () => {
  it("maps input_audio_buffer.speech_started to the listening indicator", () => {
    const raw = JSON.stringify({ type: "input_audio_buffer.speech_started" });
    expect(indicatorForEvent(raw)).toBe("listening");
  });

  it("ignores every other event type in v0.1", () => {
    const others = [
      "input_audio_buffer.speech_stopped",
      "output_audio_buffer.started",
      "response.done",
      "session.created",
      "error",
    ];
    for (const type of others) {
      expect(indicatorForEvent(JSON.stringify({ type }))).toBeNull();
    }
  });

  it("never throws on malformed data channel payloads", () => {
    expect(indicatorForEvent("not json")).toBeNull();
    expect(indicatorForEvent("")).toBeNull();
    expect(indicatorForEvent("{}")).toBeNull();
  });
});

describe("hard cut", () => {
  it("keeps the contract constants: 20:00 budget, 25:00 hard cut", () => {
    expect(SESSION_BUDGET_S).toBe(1200);
    expect(HARD_CUT_S).toBe(1500);
  });

  it("does not trigger before 1500s", () => {
    expect(isHardCut(0)).toBe(false);
    expect(isHardCut(1499)).toBe(false);
  });

  it("triggers at exactly 1500s and after", () => {
    expect(isHardCut(1500)).toBe(true);
    expect(isHardCut(1501)).toBe(true);
  });
});

describe("timeStatusCheckpoints", () => {
  it("fires at 75% elapsed and at the wrap-up margin for the 20:00 budget", () => {
    const [threeQ, wrap] = timeStatusCheckpoints();
    expect(threeQ.atS).toBe(900);
    expect(wrap.atS).toBe(1080);
  });

  it("every note carries the [time status] contract marker", () => {
    for (const cp of timeStatusCheckpoints()) {
      expect(cp.text.startsWith(TIME_STATUS_PREFIX)).toBe(true);
    }
  });

  it("names the minutes remaining", () => {
    const [threeQ, wrap] = timeStatusCheckpoints();
    expect(threeQ.text).toContain("About 5 minutes remain");
    expect(wrap.text).toContain("About 2 minutes remain");
  });
});

describe("dueTimeStatus", () => {
  it("is null before the first checkpoint", () => {
    expect(dueTimeStatus(899, 0)).toBeNull();
  });

  it("returns the first checkpoint once reached", () => {
    expect(dueTimeStatus(900, 0)?.atS).toBe(900);
  });

  it("does not re-fire an already-sent checkpoint", () => {
    expect(dueTimeStatus(1000, 1)).toBeNull();
    expect(dueTimeStatus(1080, 1)?.atS).toBe(1080);
  });

  it("is null when every checkpoint is sent", () => {
    expect(dueTimeStatus(1499, 2)).toBeNull();
  });

  it("still fires a checkpoint a delayed tick has passed (throttled tabs)", () => {
    expect(dueTimeStatus(1200, 0)?.atS).toBe(900);
  });
});

describe("greetingTriggerEvent", () => {
  it("builds the response.create nudge that makes Morgan speak first", () => {
    expect(JSON.parse(greetingTriggerEvent())).toEqual({
      type: "response.create",
    });
  });
});

describe("timeStatusEvent", () => {
  it("builds a conversation.item.create system note", () => {
    const parsed = JSON.parse(timeStatusEvent("[time status] test"));
    expect(parsed.type).toBe("conversation.item.create");
    expect(parsed.item.type).toBe("message");
    expect(parsed.item.role).toBe("system");
    expect(parsed.item.content[0]).toEqual({
      type: "input_text",
      text: "[time status] test",
    });
  });
});

const QUIET: SilenceTick = {
  dtS: 0.25,
  candidateAudible: false,
  interviewerAudible: false,
  commitArrived: false,
};

function runTicks(state: SilenceClockState, ticks: SilenceTick[]) {
  const stages: string[] = [];
  let triggers = 0;
  for (const tick of ticks) {
    const r = nextSilenceState(state, tick);
    state = r.state;
    if (r.effects.stage) stages.push(r.effects.stage.text);
    if (r.effects.triggerResponse) triggers += 1;
  }
  return { state, stages, triggers };
}

const quietFor = (s: number) => Array(Math.round(s / 0.25)).fill(QUIET);
const candidateFor = (s: number) =>
  Array(Math.round(s / 0.25)).fill({ ...QUIET, candidateAudible: true });
const interviewerFor = (s: number) =>
  Array(Math.round(s / 0.25)).fill({ ...QUIET, interviewerAudible: true });

describe("silence clock", () => {
  it("fires stage 1 once at 8s of quiet", () => {
    const { stages } = runTicks(INITIAL_SILENCE_STATE, quietFor(10));
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
    expect(stages[0].startsWith(SILENCE_STATUS_PREFIX)).toBe(true);
  });

  it("escalates through stages 2 and 3, then stops", () => {
    const { stages } = runTicks(INITIAL_SILENCE_STATE, quietFor(45));
    expect(stages).toEqual(SILENCE_STAGES.map((s) => s.text));
  });

  it("resets on candidate speech of 2s or more", () => {
    const mid = runTicks(INITIAL_SILENCE_STATE, [
      ...quietFor(6),
      ...candidateFor(STALL_BLIP_MAX_S + 0.5),
    ]);
    expect(mid.state.quietS).toBe(0);
    const after = runTicks(mid.state, quietFor(7.5));
    expect(after.stages).toEqual([]);
  });

  it("stall blips pause but do not reset accumulation", () => {
    const { stages } = runTicks(INITIAL_SILENCE_STATE, [
      ...quietFor(6),
      ...candidateFor(1),
      ...quietFor(2.5),
    ]);
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
  });

  it("interviewer audio pauses but never resets", () => {
    const { stages } = runTicks(INITIAL_SILENCE_STATE, [
      ...quietFor(5),
      ...interviewerFor(3),
      ...quietFor(3.5),
    ]);
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
  });

  it("a commit arms a debounced response trigger", () => {
    const { triggers } = runTicks(INITIAL_SILENCE_STATE, [
      { ...QUIET, commitArrived: true },
      ...quietFor(RESPONSE_DEBOUNCE_S + 0.5),
    ]);
    expect(triggers).toBe(1);
  });

  it("candidate sound cancels a pending response", () => {
    const { triggers } = runTicks(INITIAL_SILENCE_STATE, [
      { ...QUIET, commitArrived: true },
      ...quietFor(0.5),
      ...candidateFor(0.5),
      ...quietFor(3),
    ]);
    expect(triggers).toBe(0);
  });

  it("a firing stage supersedes a pending response", () => {
    const { stages, triggers } = runTicks(INITIAL_SILENCE_STATE, [
      ...quietFor(7.5),
      { ...QUIET, commitArrived: true },
      ...quietFor(3),
    ]);
    expect(stages).toEqual([SILENCE_STAGES[0].text]);
    expect(triggers).toBe(0);
  });
});

describe("silence events and wire helpers", () => {
  it("silenceStatusEvent shapes a system note", () => {
    const parsed = JSON.parse(silenceStatusEvent(SILENCE_STAGES[0].text));
    expect(parsed.type).toBe("conversation.item.create");
    expect(parsed.item.role).toBe("system");
    expect(parsed.item.content[0].text).toBe(SILENCE_STAGES[0].text);
  });

  it("responseTriggerEvent is a bare response.create", () => {
    expect(JSON.parse(responseTriggerEvent())).toEqual({
      type: "response.create",
    });
  });

  it("speechStateForEvent maps the three input events and ignores junk", () => {
    const mk = (type: string) => JSON.stringify({ type });
    expect(speechStateForEvent(mk("input_audio_buffer.speech_started"))).toBe(
      "started",
    );
    expect(speechStateForEvent(mk("input_audio_buffer.speech_stopped"))).toBe(
      "stopped",
    );
    expect(speechStateForEvent(mk("input_audio_buffer.committed"))).toBe(
      "committed",
    );
    expect(speechStateForEvent(mk("response.done"))).toBeNull();
    expect(speechStateForEvent("not json")).toBeNull();
  });
});

describe("interviewer lifecycle events (F-06 hotfix — no single-signal dependence)", () => {
  const mk = (type: string) => JSON.stringify({ type });

  it("maps output_audio_buffer lifecycle and response.done", () => {
    expect(interviewerStateForEvent(mk("output_audio_buffer.started"))).toBe(
      "speaking",
    );
    expect(interviewerStateForEvent(mk("output_audio_buffer.stopped"))).toBe(
      "quiet",
    );
    expect(interviewerStateForEvent(mk("output_audio_buffer.cleared"))).toBe(
      "quiet",
    );
    expect(interviewerStateForEvent(mk("response.done"))).toBe(
      "response_done",
    );
    expect(interviewerStateForEvent(mk("input_audio_buffer.speech_started"))).toBeNull();
    expect(interviewerStateForEvent("not json")).toBeNull();
  });
});
