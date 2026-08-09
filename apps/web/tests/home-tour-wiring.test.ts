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
    const writes = emitted.match(/markTourDone\(/g) ?? [];
    expect(writes.length, "the once flag is written from more than one place").toBe(1);
    expect(emitted).toContain("if (outcome.markDone) markTourDone();");
    // That count is a spelling, not the rule, and the spelling is trivial to
    // step around: `const spendArrival = markTourDone;` with the no-anchor
    // path ending `return spendArrival();` leaves one `markTourDone(`, one
    // `setTour(null)`, the no-anchor line still reading `if (steps.length ===
    // 0) return`, and the whole suite green — while a home with nothing to
    // point at spends the arrival it never showed. Reaching `localStorage`
    // directly gets there too. So count every mention of the identifier, the
    // import and that one call and nothing else, and deny the component any
    // name for the storage surface itself.
    const mentions = emitted.match(/\bmarkTourDone\b/g) ?? [];
    expect(mentions.length, "markTourDone is aliased, re-exported, or called again").toBe(2);
    expect(emitted, "the component writes the flag past its storage module").not.toMatch(
      /localStorage|sessionStorage|fc-tour-done/,
    );
  });

  it("ends the tour from exactly one place, so every ending writes the flag", () => {
    // Each dismissal used to close the tour itself, which meant any one of
    // them could stop writing the flag without another one noticing.
    const closes = emitted.match(/setTour\(null\)/g) ?? [];
    expect(closes.length, "a dismissal closes the tour outside apply()").toBe(1);
    // And the close has to sit in the branch that just wrote the flag. The
    // count alone does not say where: lifting the close out of apply() and
    // hanging it off the Skip handler keeps it at one, and then Escape and
    // Done write the flag onto a tour that stays on screen with no way out.
    expect(emitted, "the ending closes outside apply()'s null branch").toMatch(
      /if \(outcome\.state === null\) \{\s*setTour\(null\);/,
    );
    // Three places move the tour state: the arrival, that close, and the step
    // change. A fourth is a path the decisions in tour/decide.ts do not govern.
    const setters = emitted.match(/setTour\(/g) ?? [];
    expect(setters.length, "the tour state is set outside the arrival and apply()").toBe(3);
  });

  it("hands the measured geometry to the elements that draw it", () => {
    // tour/geometry.ts is tested hard and was wired to nothing any test could
    // see, which let two mutations through every gate: freezing the card on
    // its pre-measure fallback while the panes tracked the target, and giving
    // the panes a data attribute instead of a style, which erases the dim
    // entirely. Both are one defect — a computed box that reaches no element.
    expect(emitted, "the card's box is not the measured placement").toMatch(
      /const cardStyle = \{\s*\.\.\.\(placement\?\.card \?\? FALLBACK_CARD\),\s*margin: 0,?\s*\}/,
    );
    expect(emitted, "the card is positioned by something other than cardStyle").toMatch(
      /ref=\{cardRef\}[\s\S]*?style=\{cardStyle\}/,
    );
    expect(emitted, "a dimming pane is drawn without its computed box").toMatch(
      /placement\?\.panes\.map\([\s\S]*?style=\{pane\}/,
    );
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
