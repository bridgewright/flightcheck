import { describe, expect, it } from "vitest";

import {
  BUTTON_LABELS,
  CAPTIONS,
  FINE_PRINTS,
  STEP_COUNT,
  TRIGGER_LABEL,
  WALKTHROUGH_TITLE,
  advance,
  atEnd,
  back,
  canBack,
  counterText,
  initialState,
  liveText,
  primaryLabel,
  replay,
  reset,
} from "@/components/linkedin-help/walkthrough-steps";

// The step model behind the LinkedIn PDF walkthrough (F-55). The component
// only wires buttons to these functions, so this suite owns the whole
// stepping behaviour and the source scan in tests/linkedin-pdf-help.test.ts
// can pin plumbing without re-litigating it.

describe("the walkthrough starts at the beginning", () => {
  it("opens on step 1 of 3", () => {
    const state = initialState();
    expect(state.step).toBe(1);
    expect(STEP_COUNT).toBe(3);
    expect(counterText(state)).toBe("1 / 3");
  });

  it("cannot go back from step 1, but the control still exists", () => {
    // Back is disabled rather than hidden so the footer never reflows; the
    // component reads canBack for the disabled state.
    expect(canBack(initialState())).toBe(false);
  });
});

describe("stepping forward and back", () => {
  it("advances 1 to 2 to 3 and no further", () => {
    const one = initialState();
    const two = advance(one);
    const three = advance(two);
    expect([one.step, two.step, three.step]).toEqual([1, 2, 3]);
    // At the end the primary action is Done, not a fourth step.
    expect(advance(three).step).toBe(3);
    expect(atEnd(three)).toBe(true);
    expect(atEnd(two)).toBe(false);
  });

  it("goes back 3 to 2 to 1 and no further", () => {
    const three = advance(advance(initialState()));
    const two = back(three);
    const one = back(two);
    expect([three.step, two.step, one.step]).toEqual([3, 2, 1]);
    expect(back(one).step).toBe(1);
    expect(canBack(two)).toBe(true);
  });

  it("relabels the same primary button rather than adding a second one", () => {
    const one = initialState();
    const two = advance(one);
    const three = advance(two);
    expect(primaryLabel(one)).toBe("Next");
    expect(primaryLabel(two)).toBe("Next");
    expect(primaryLabel(three)).toBe("Done");
  });
});

describe("what each position announces", () => {
  it("counts for the eye as n / 3", () => {
    const one = initialState();
    const two = advance(one);
    const three = advance(two);
    expect(counterText(one)).toBe("1 / 3");
    expect(counterText(two)).toBe("2 / 3");
    expect(counterText(three)).toBe("3 / 3");
  });

  it("counts for the screen reader as a sentence", () => {
    // The visible counter is aria-hidden; the live region announces this
    // string instead, so nothing is announced twice.
    const one = initialState();
    expect(liveText(one)).toBe("Step 1 of 3.");
    expect(liveText(advance(one))).toBe("Step 2 of 3.");
    expect(liveText(advance(advance(one)))).toBe("Step 3 of 3.");
  });
});

describe("replay and reset", () => {
  it("replay bumps the run id and stays on the step", () => {
    const two = advance(initialState());
    const again = replay(two);
    expect(again.step).toBe(2);
    expect(again.runId).toBe(two.runId + 1);
  });

  it("stepping keeps the run id, so only replay and reset restart a run", () => {
    const one = initialState();
    expect(advance(one).runId).toBe(one.runId);
    expect(back(advance(one)).runId).toBe(one.runId);
  });

  it("reset returns to step 1 with a fresh run, for reopen", () => {
    // The component resets on every open, so a deliberate close then reopen
    // is a fresh read from the first step.
    const wandered = replay(advance(advance(initialState())));
    const fresh = reset(wandered);
    expect(fresh.step).toBe(1);
    expect(fresh.runId).toBe(wandered.runId + 1);
  });
});

describe("the copy is the spec's copy, byte for byte", () => {
  it("carries the three captions exactly", () => {
    expect(CAPTIONS[1]).toBe(
      "On LinkedIn, open your own profile, then click More, sometimes labeled Resources, in the box under your name.",
    );
    expect(CAPTIONS[2]).toBe(
      "In the menu that opens, click Save to PDF. LinkedIn downloads your profile as a PDF file.",
    );
    expect(CAPTIONS[3]).toBe(
      "Back in this tab, choose the downloaded file in the LinkedIn profile PDF field below.",
    );
  });

  it("carries the three fine print lines exactly", () => {
    expect(FINE_PRINTS[1]).toBe("Desktop only: the LinkedIn mobile app does not offer this.");
    expect(FINE_PRINTS[2]).toBe("Can't find it? Any exported profile PDF works here.");
    expect(FINE_PRINTS[3]).toBe("Prefer text? Paste your profile into the text box instead.");
  });

  it("names the title, the trigger, and the buttons exactly", () => {
    expect(WALKTHROUGH_TITLE).toBe("Export your profile from LinkedIn");
    expect(TRIGGER_LABEL).toBe("How to export this PDF from LinkedIn");
    expect(BUTTON_LABELS).toEqual({ back: "Back", next: "Next", done: "Done", replay: "Replay" });
  });

  it("keeps the register: no shouting, no dashes", () => {
    // The house copy rules, applied to every string this feature renders: an
    // exclamation mark reads as sales, and the dash characters are banned
    // repo wide in favour of commas, colons, and parentheses.
    const lines = [
      WALKTHROUGH_TITLE,
      TRIGGER_LABEL,
      ...Object.values(CAPTIONS),
      ...Object.values(FINE_PRINTS),
      ...Object.values(BUTTON_LABELS),
    ];
    for (const line of lines) {
      expect(line, line).not.toMatch(/[!–—]/);
    }
  });

  it("hedges the button LinkedIn itself hedges", () => {
    // LinkedIn's own help says the entry point is "More or Resources", and
    // says the export is unavailable to some members. The caption hedges the
    // name and the fine print offers the way out.
    expect(CAPTIONS[1]).toContain("sometimes labeled Resources");
    expect(FINE_PRINTS[2]).toContain("Any exported profile PDF works here");
  });
});
