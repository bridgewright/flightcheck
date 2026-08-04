import { describe, expect, it } from "vitest";

import { dismissDecision } from "@/components/light-dismiss";

// The rule that decides whether an open menu closes (F-57). The component
// wires document listeners to it; this suite owns the decision itself, so the
// wiring scan in tests/light-dismiss-client.test.ts can pin plumbing without
// re-litigating behaviour.

describe("dismissDecision on pointerdown", () => {
  it("closes when the pointer goes down outside the details element", () => {
    expect(dismissDecision({ kind: "pointerdown", targetInsideDetails: false })).toEqual({
      refocusSummary: false,
    });
  });

  it("does not steal focus on an outside pointerdown", () => {
    // The pointer is on its way somewhere else, possibly the other menu's
    // trigger. Yanking focus back mid-click would fight that target.
    const decision = dismissDecision({ kind: "pointerdown", targetInsideDetails: false });
    expect(decision?.refocusSummary).toBe(false);
  });

  it("stays open when the pointer goes down inside, summary included", () => {
    // The summary sits inside the details element. If pointerdown on the own
    // summary closed the menu, the native click that follows would toggle it
    // straight back open, and the trigger could never close its own menu.
    expect(dismissDecision({ kind: "pointerdown", targetInsideDetails: true })).toBeNull();
  });
});

describe("dismissDecision on keydown", () => {
  it("closes on Escape and returns focus to the summary", () => {
    expect(dismissDecision({ kind: "keydown", key: "Escape" })).toEqual({
      refocusSummary: true,
    });
  });

  it("ignores every other key", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowDown", "a", "Esc "]) {
      expect(dismissDecision({ kind: "keydown", key }), key).toBeNull();
    }
  });
});
