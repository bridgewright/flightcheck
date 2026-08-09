import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/HomeTour.tsx", import.meta.url)),
  "utf8",
);

/**
 * Source with comments blanked out, the way the design-system scan does it.
 * The checks below are about what the component emits, not what it explains,
 * and the comment recording that `m-0` is inert must not be the thing that
 * fails the check for `m-0`.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}
const emitted = withoutComments(source);

// There is no DOM harness in this suite, so what a renderer would assert is
// pinned as source here and the decisions themselves are tested for real in
// components/tour/. That split is only worth anything if the pins are
// mutation-sensitive, and the first version of this file was not: deleting the
// flag write from Escape, deleting it from Skip, and adding one to the
// no-anchor path all left the suite green, because each check looked for a
// string that survived the mutation somewhere else in the file. The pins below
// count call sites instead, which is the property the mutations broke.

describe("home tour wiring", () => {
  it("opens after paint only when storage allows and anchors exist", () => {
    expect(source).toContain("shouldShowTour()");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain('document.querySelectorAll<HTMLElement>("[data-tour]")');
    expect(source).toContain("if (steps.length === 0) return");
  });

  it("renders an accessible dialog and hides both visible counters from it", () => {
    expect(source).toContain('role="dialog"');
    // The LinkedIn walkthrough's recorded stance, pinned the same way there:
    // Tab can leave this dialog, so claiming aria-modal would lie to screen
    // readers. No modal claim, no trap.
    expect(source).not.toContain("aria-modal");
    expect(source).toContain('aria-live="polite"');
    // The numeral chip and the "1 / 4" counter both restate the position the
    // live region announces, so both carry aria-hidden. One of them did not,
    // and a screen reader read a bare "1" before every step.
    const hidden = source.match(/aria-hidden="true"/g) ?? [];
    expect(hidden.length, "a visible mark is announced as well as the live region")
      .toBeGreaterThanOrEqual(3);
    expect(source).toMatch(/aria-hidden="true"\s+className=\{STEP_NUMERAL\}/);
  });

  it("writes the once flag from exactly one place, and only through a decision", () => {
    // The property this protects: no path other than an ended tour can write
    // the flag. A second call site is how the no-anchor render would come to
    // spend an arrival it never showed.
    const writes = source.match(/markTourDone\(/g) ?? [];
    expect(writes.length, "the once flag is written from more than one place").toBe(1);
    expect(source).toContain("if (outcome.markDone) markTourDone();");
  });

  it("ends the tour from exactly one place, so every ending writes the flag", () => {
    // Each dismissal used to close the tour itself, which meant any one of
    // them could stop writing the flag without another one noticing.
    const closes = source.match(/setTour\(null\)/g) ?? [];
    expect(closes.length, "a dismissal closes the tour outside apply()").toBe(1);
  });

  it("routes every button and key through the tested decisions", () => {
    expect(source).toContain("apply(decideSkip(tour.state))");
    expect(source).toContain("apply(decideBack(tour.state))");
    expect(source).toContain("apply(decideNext(tour.state, tour.steps))");
    expect(source).toContain("decideKey(event.key, tour.state, tour.steps)");
    // The listener is on the window: a key the tour does not claim has to
    // reach the page, so the default is only prevented once handled.
    expect(source).toContain("if (!outcome.handled) return;");
  });

  it("supports focus, scrolling, and geometry refresh", () => {
    expect(source).toContain("scrollIntoView");
    expect(source).toContain("focus()");
    expect(source).toContain('addEventListener("resize"');
    expect(source).toContain('addEventListener("scroll"');
    expect(source).toContain("tourGeometry(");
  });

  it("uses four token-coloured pointer-blocking panes and the menu surface", () => {
    expect(source).toContain("MENU_PANEL");
    expect(source).toContain("STEP_NUMERAL");
    expect(source).toContain("pointer-events-auto");
    // The /NN modifier spelling, not `bg-ink opacity-60`: the design-system
    // COMPOSITES scan only recognises the modifier form, and a colour the
    // gate cannot see is a colour the gate cannot check.
    expect(source).toContain("bg-ink/60");
    expect(source).not.toContain("opacity-60");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(/i);
  });

  it("positions the card from the inline style rather than from class order", () => {
    // Measured, not assumed: Tailwind emits `.m-0` before `.mt-1.5`, so
    // MENU_PANEL's `mt-1.5` won the conflict and the card painted 6px below
    // where the geometry put it. An override that only works if the emission
    // order happens to favour it is not an override.
    expect(source).toContain("margin: 0");
    expect(emitted, "m-0 is inert against MENU_PANEL's mt-1.5").not.toMatch(/\bm-0\b/);
    expect(emitted, "top-0 is inert against an inline top").not.toMatch(/\btop-0\b/);
  });
});
