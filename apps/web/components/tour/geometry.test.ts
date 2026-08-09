import { describe, expect, it } from "vitest";

import { tourGeometry } from "./geometry";

describe("coach-mark geometry", () => {
  it("builds four panes around the target", () => {
    const result = tourGeometry(
      { top: 100, left: 200, right: 300, bottom: 140, width: 100, height: 40 },
      { width: 800, height: 600 },
      { width: 280, height: 180 },
    );
    expect(result.panes).toEqual([
      { top: 0, left: 0, width: 800, height: 100 },
      { top: 140, left: 0, width: 800, height: 460 },
      { top: 100, left: 0, width: 200, height: 40 },
      { top: 100, left: 300, width: 500, height: 40 },
    ]);
    expect(result.card).toEqual({ top: 152, left: 200 });
  });

  it("never sizes a pane negative when the target hangs off the top or left", () => {
    // A negative width or height is not a CSS length, so the browser drops the
    // declaration and the pane paints at its content size — a hole in the dim
    // exactly where the tour claims to be covering the screen. The bottom and
    // right panes were already floored; these two were not, and a target
    // scrolled under the sticky bar reaches this every time.
    const result = tourGeometry(
      { top: -20, left: -30, right: 70, bottom: 20, width: 100, height: 40 },
      { width: 800, height: 600 },
      { width: 280, height: 180 },
    );
    for (const [index, pane] of result.panes.entries()) {
      expect(pane.width, `pane ${index} width`).toBeGreaterThanOrEqual(0);
      expect(pane.height, `pane ${index} height`).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the card inside a 360px phone, against a target at the right edge", () => {
    // The narrowest screen the product is read on. The card is
    // `min(18rem, 100vw - 1.5rem)` wide, so it measures 288 here and the only
    // thing keeping it on screen is the clamp.
    const viewport = { width: 360, height: 640 };
    const card = { width: 288, height: 180 };
    const result = tourGeometry(
      { top: 40, left: 300, right: 352, bottom: 76, width: 52, height: 36 },
      viewport,
      card,
    );
    expect(result.card.left).toBeGreaterThanOrEqual(12);
    expect(result.card.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(result.card.top).toBeGreaterThanOrEqual(12);
    expect(result.card.top + card.height).toBeLessThanOrEqual(viewport.height - 12);
  });

  it("places above when needed and clamps to the viewport", () => {
    const result = tourGeometry(
      { top: 560, left: 760, right: 800, bottom: 600, width: 40, height: 40 },
      { width: 800, height: 600 },
      { width: 280, height: 180 },
    );
    expect(result.card).toEqual({ top: 368, left: 508 });
  });
});
