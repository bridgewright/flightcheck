import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { overallTrendAriaLabel } from "@/components/OverallTrend";
import { trendGeometry } from "@/components/trend-line";
import TrendLine from "@/components/TrendLine";

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

  it("marks only the point in the highest slot as latest", () => {
    const geometry = trendGeometry(
      [
        { slot: 1, score: 2 },
        { slot: 3, score: 4 },
        { slot: 2, score: 3 },
      ],
      3,
      size,
    );

    expect(geometry.dots.map((dot) => dot.latest)).toEqual([false, false, true]);
  });

  it("sorts unsorted points by slot in both dots and line", () => {
    const geometry = trendGeometry(
      [
        { slot: 3, score: 4 },
        { slot: 1, score: 2 },
        { slot: 2, score: 3 },
      ],
      3,
      size,
    );

    expect(geometry.dots.map((dot) => dot.score)).toEqual([2, 3, 4]);
    expect(geometry.line).toBe("10,40 50,30 90,20");
  });

  it("emits one space-separated x,y pair for every dot", () => {
    const geometry = trendGeometry(
      [
        { slot: 2, score: 2.25 },
        { slot: 1, score: 3.75 },
      ],
      3,
      size,
    );
    const pairs = geometry.line.split(" ");

    expect(pairs).toHaveLength(geometry.dots.length);
    expect(pairs).toEqual(
      geometry.dots.map((dot) => `${dot.x},${dot.y}`),
    );
  });
});

describe("TrendLine", () => {
  const points = [
    { slot: 1, score: 2 },
    { slot: 2, score: 3 },
  ];

  it("renders hero graphics separately from document-sized text and dots", () => {
    const markup = renderToStaticMarkup(createElement(TrendLine, {
      points, totalSlots: 4, variant: "hero", ariaLabel: "Trend",
    }));

    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Trend"');
    expect(markup).toContain('preserveAspectRatio="none"');
    expect(markup).toContain('vector-effect="non-scaling-stroke"');
    expect(markup).not.toContain("<text");
    expect(markup.match(/<polygon/g)).toHaveLength(1);
    expect(markup).toContain('class="fill-sky"');
    expect(markup).toContain('fill-opacity="0.45"');
    expect(markup).toContain('class="stroke-ink-muted"');
    expect(markup.match(/data-trend-dot=/g)).toHaveLength(2);
    expect(markup.match(/data-slot-label=/g)).toHaveLength(4);
  });

  it("renders the spark at its displayed aspect ratio with area and ink line", () => {
    const markup = renderToStaticMarkup(createElement(TrendLine, {
      points, totalSlots: 4, variant: "spark", ariaLabel: "Trend",
    }));

    expect(markup).toContain('viewBox="0 0 160 36"');
    expect(markup).not.toContain("<text");
    expect(markup).toContain('class="fill-sky"');
    expect(markup).toContain('fill-opacity="0.45"');
    expect(markup).toContain('class="stroke-ink-muted"');
    expect(markup).not.toContain("data-trend-dot");
  });

  it("anchors every slot label at the same x as the dots it labels", () => {
    const markup = renderToStaticMarkup(createElement(TrendLine, {
      points: [
        { slot: 1, score: 2 },
        { slot: 6, score: 4 },
      ],
      totalSlots: 6,
      variant: "hero",
      ariaLabel: "Trend",
    }));

    const dotLefts = [...markup.matchAll(/data-trend-dot[^>]*left:([\d.]+)%/g)]
      .map((match) => match[1]);
    const labelLefts = [...markup.matchAll(/data-slot-label[^>]*left:([\d.]+)%/g)]
      .map((match) => match[1]);
    expect(dotLefts).toHaveLength(2);
    expect(labelLefts).toHaveLength(6);
    expect(labelLefts[0]).toBe(dotLefts[0]);
    expect(labelLefts[5]).toBe(dotLefts[1]);
    expect(
      markup.match(/data-slot-label[^>]*-translate-x-1\/2/g),
    ).toHaveLength(6);
  });

  it("keeps the printed score inside the wrapper at the top of the scale", () => {
    const markup = renderToStaticMarkup(createElement(TrendLine, {
      points: [{ slot: 6, score: 5 }],
      totalSlots: 6,
      variant: "hero",
      ariaLabel: "Trend",
    }));

    const label = markup.match(/-translate-y-full[^>]*top:([\d.]+)%/);
    expect(label).not.toBeNull();
    expect(Number(label![1])).toBeGreaterThan(0);
  });

  it("omits the polyline and area for a lone point in both variants", () => {
    for (const variant of ["hero", "spark"] as const) {
      const markup = renderToStaticMarkup(createElement(TrendLine, {
        points: [points[0]], totalSlots: 4, variant, ariaLabel: "Trend",
      }));
      expect(markup).not.toContain("<polyline");
      expect(markup).not.toContain("<polygon");
    }
  });
});

describe("overallTrendAriaLabel", () => {
  it("binds scored and planned session counts unambiguously", () => {
    expect(overallTrendAriaLabel([
      { index: 1, score: 3 },
      { index: 2, score: 3.5 },
    ], 6)).toBe(
      "Overall score trend: 2 of 6 planned sessions scored; session 1, 3.0 out of 5; session 2, 3.5 out of 5; net change +0.5.",
    );
  });
});
