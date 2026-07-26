import { describe, expect, it } from "vitest";

import {
  HARD_CUT_S,
  SESSION_BUDGET_S,
  formatTimer,
  indicatorForEvent,
  isHardCut,
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
