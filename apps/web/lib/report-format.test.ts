import { describe, expect, it } from "vitest";

import { topObservations } from "./report-format";
import type { TimestampedObservation } from "./types";

const obs = (
  at_s: number,
  conflicts_with_dsp = false,
): TimestampedObservation => ({
  at_s,
  kind: "pace",
  note: `note at ${at_s}`,
  conflicts_with_dsp,
});

describe("topObservations", () => {
  it("returns everything when the list fits the cap", () => {
    const all = [obs(10), obs(20)];
    expect(topObservations(all, 5)).toEqual(all);
  });

  it("caps at max, keeping the earliest of the rest", () => {
    const all = [obs(10), obs(20), obs(30), obs(40), obs(50), obs(60)];
    expect(topObservations(all, 5).map((o) => o.at_s)).toEqual([
      10, 20, 30, 40, 50,
    ]);
  });

  it("always includes DSP conflicts, even late ones, in timeline order", () => {
    const all = [obs(10), obs(20), obs(30), obs(40), obs(50), obs(60, true)];
    expect(topObservations(all, 5).map((o) => o.at_s)).toEqual([
      10, 20, 30, 40, 60,
    ]);
  });

  it("handles an empty list", () => {
    expect(topObservations([], 5)).toEqual([]);
  });
});
