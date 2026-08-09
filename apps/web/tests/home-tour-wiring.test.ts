import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/HomeTour.tsx", import.meta.url)),
  "utf8",
);

describe("home tour wiring", () => {
  it("opens after paint only when storage allows and anchors exist", () => {
    expect(source).toContain("shouldShowTour()");
    expect(source).toContain("requestAnimationFrame");
    expect(source).toContain('document.querySelectorAll<HTMLElement>("[data-tour]")');
    expect(source).toContain("if (steps.length === 0) return");
  });

  it("renders an accessible dialog and counters", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-hidden="true"');
  });

  it("finishes through skip, done, and Escape", () => {
    expect(source).toContain("markTourDone()");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("finishTour");
    expect(source).toContain("Skip");
  });

  it("supports arrow navigation, focus, scrolling, and geometry refresh", () => {
    expect(source).toContain('event.key === "ArrowRight"');
    expect(source).toContain('event.key === "ArrowLeft"');
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
    expect(source).toContain("bg-ink opacity-60");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(/i);
  });
});
