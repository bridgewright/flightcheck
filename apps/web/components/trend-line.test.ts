import { describe, expect, it } from "vitest";

import { trendGeometry } from "@/components/trend-line";

const size = {
  width: 100,
  height: 80,
  pad: { x: 10, top: 10, bottom: 20 },
};

describe("trendGeometry", () => {
  it("spreads every planned slot evenly across the padded width", () => {
    const geometry = trendGeometry([], 3, size);

    expect(geometry.slots.map((slot) => slot.x)).toEqual([10, 50, 90]);
  });

  it("maps higher scores to smaller y coordinates", () => {
    const geometry = trendGeometry(
      [
        { slot: 1, score: 1 },
        { slot: 2, score: 5 },
      ],
      2,
      size,
    );

    expect(geometry.dots[1].y).toBeLessThan(geometry.dots[0].y);
    expect(geometry.dots.map((dot) => dot.y)).toEqual([50, 10]);
  });

  it("centres a single point and emits one coordinate pair", () => {
    const geometry = trendGeometry([{ slot: 1, score: 3 }], 1, size);

    expect(geometry.dots).toEqual([
      { x: 50, y: 30, score: 3, latest: true },
    ]);
    expect(geometry.line).toBe("50,30");
  });

  it("clamps the slot domain to the highest plotted slot", () => {
    const geometry = trendGeometry([{ slot: 4, score: 2 }], 2, size);

    expect(geometry.slots).toHaveLength(4);
    expect(geometry.dots[0].x).toBe(90);
  });

  it("returns no line or dots for empty points", () => {
    const geometry = trendGeometry([], 2, size);

    expect(geometry.line).toBe("");
    expect(geometry.dots).toEqual([]);
  });

  it("creates one grid line for every integer rubric score", () => {
    const geometry = trendGeometry([], 1, size);

    expect(geometry.gridLines.map((line) => line.score)).toEqual([1, 2, 3, 4, 5]);
  });

  it("labels the complete slot sequence", () => {
    const geometry = trendGeometry([], 4, size);

    expect(geometry.slots.map((slot) => slot.label)).toEqual(["S1", "S2", "S3", "S4"]);
  });
});
