import { describe, expect, it } from "vitest";

import {
  HARD_CUT_S,
  SESSION_BUDGET_S,
  TIME_STATUS_PREFIX,
  dueTimeStatus,
  formatTimer,
  indicatorForEvent,
  isHardCut,
  timeStatusCheckpoints,
  timeStatusEvent,
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
