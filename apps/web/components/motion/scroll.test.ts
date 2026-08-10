import { describe, expect, it } from "vitest";

import { DRIFT_MAX_PX, DRIFT_RANGE_PX, driftY } from "./scroll";

// The hero cloud's scroll drift is a pure mapping from scroll position to a
// translateY, and this file is where its budget is held: the leaf that
// consumes it may add nothing, so every property of the motion is a property
// of this function.

describe("the drift budget", () => {
  it("travels a couple dozen pixels at most, never more", () => {
    // The user's ask, verbatim in spirit: "drift a little with scroll". A
    // travel past two dozen pixels stops being a drift and starts being a
    // parallax feature.
    expect(DRIFT_MAX_PX).toBeGreaterThan(0);
    expect(DRIFT_MAX_PX).toBeLessThanOrEqual(24);
  });

  it("lags the scroll rather than racing it", () => {
    // The whole travel is spent over a much longer scroll distance, so the
    // cloud reads as sitting behind the page. A rate at or past 1:1 would
    // attach it to the reader's finger, which is the opposite of depth.
    expect(DRIFT_RANGE_PX).toBeGreaterThan(DRIFT_MAX_PX);
    expect(DRIFT_MAX_PX / DRIFT_RANGE_PX).toBeLessThan(0.1);
  });
});

describe("driftY, the whole motion", () => {
  it("is settled at the top of the page", () => {
    // The settled state IS the server render: at scroll 0 the transform is 0,
    // so a no-JS reader, a pre-hydration frame, and a reduced-motion reader
    // all see the same cloud in the same place.
    expect(driftY(0)).toBe(0);
  });

  it("stays settled through rubber-band overscroll", () => {
    // Safari reports negative scrollY while the page bounces at the top; a
    // linear map without a floor would drift the cloud upward there.
    expect(driftY(-1)).toBe(0);
    expect(driftY(-500)).toBe(0);
  });

  it("moves linearly with the scroll, because scrub-linked motion has no easing", () => {
    // The drift is position-driven, not clocked: the reader's own scroll is
    // the timeline, and easing a direct manipulation makes it feel detached.
    expect(driftY(DRIFT_RANGE_PX / 2)).toBeCloseTo(DRIFT_MAX_PX / 2, 10);
    expect(driftY(DRIFT_RANGE_PX / 4)).toBeCloseTo(DRIFT_MAX_PX / 4, 10);
  });

  it("caps at the full travel and holds it", () => {
    expect(driftY(DRIFT_RANGE_PX)).toBe(DRIFT_MAX_PX);
    expect(driftY(DRIFT_RANGE_PX * 20)).toBe(DRIFT_MAX_PX);
  });

  it("never reverses while the reader scrolls down", () => {
    let previous = driftY(0);
    for (let scrollTop = 0; scrollTop <= DRIFT_RANGE_PX * 2; scrollTop += 7) {
      const next = driftY(scrollTop);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });
});
