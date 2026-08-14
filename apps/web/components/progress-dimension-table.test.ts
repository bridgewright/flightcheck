import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProgressDimensionTable from "@/components/ProgressDimensionTable";
import type { DimensionMeta } from "@/components/progress-view";
import type { DimensionTrend } from "@/lib/progress";

// Rendered markup, not source regex: the direction wash, the net ink, and the
// dimension glyph are all things a reader sees, so the assertions read what
// the server actually renders.

const META: Record<string, DimensionMeta> = {
  "customer-centric-deployment": {
    name: "Customer-Centric Problem Solving & Deployment",
    channel: "content",
  },
  "communication-delivery": {
    name: "Communication Delivery",
    channel: "delivery",
  },
};

function trend(key: string, scores: number[]): DimensionTrend {
  return {
    dimension_key: key,
    points: scores.map((score, i) => ({
      session_id: `s${i + 1}`,
      index: i + 1,
      score,
    })),
    // Same contract as lib/progress.ts: last minus first, 0 under two points.
    net: scores.length >= 2 ? scores[scores.length - 1] - scores[0] : 0,
  };
}

function render(trends: DimensionTrend[]): string {
  return renderToStaticMarkup(
    createElement(ProgressDimensionTable, { trends, meta: META, totalSlots: 6 }),
  );
}

describe("ProgressDimensionTable trend direction (DECISIONS 070)", () => {
  it("washes a rising sparkline sky and prints its net in the rise ink", () => {
    const markup = render([trend("customer-centric-deployment", [3.0, 3.5])]);
    expect(markup).toContain('class="fill-sky"');
    expect(markup).toMatch(/text-trend-rise[^>]*>\+0\.5</);
  });

  it("washes a falling sparkline blush, never alarm, with the fall ink net", () => {
    const markup = render([trend("customer-centric-deployment", [3.5, 3.2])]);
    expect(markup).toContain('class="fill-blush"');
    expect(markup).toMatch(/text-trend-fall[^>]*>-0\.3</);
    expect(markup).not.toContain("alarm");
  });

  it("keeps a flat trend neutral: hairline wash, faint ink net", () => {
    const markup = render([trend("customer-centric-deployment", [3.5, 3.54])]);
    expect(markup).toContain('class="fill-hairline"');
    expect(markup).toMatch(/text-ink-faint[^>]*>0\.0</);
    expect(markup).not.toContain("fill-sky");
    expect(markup).not.toContain("fill-blush");
  });

  it("makes no direction claim for a single scored session", () => {
    // One point draws no area and prints no net, so there is nothing for a
    // direction to colour: the net cell stays the empty rule.
    const markup = render([trend("customer-centric-deployment", [3.0])]);
    expect(markup).not.toContain("text-trend-rise");
    expect(markup).not.toContain("text-trend-fall");
    expect(markup).toContain("bg-hairline");
  });
});

describe("ProgressDimensionTable dimension glyphs (DECISIONS 071)", () => {
  it("draws a keyword-chosen glyph before each known dimension name", () => {
    const markup = render([
      trend("customer-centric-deployment", [3.0, 3.5]),
      trend("communication-delivery", [3.0, 3.5]),
    ]);
    expect(markup).toContain('data-glyph="person"');
    expect(markup).toContain('data-glyph="wave"');
  });

  it("draws the glyph in the F-43 register, decorative and ink-inheriting", () => {
    const markup = render([trend("customer-centric-deployment", [3.0, 3.5])]);
    const glyph = markup.match(/<svg[^>]*data-glyph[^>]*>/)?.[0] ?? "";
    expect(glyph).toContain('viewBox="0 0 24 24"');
    expect(glyph).toContain('stroke="currentColor"');
    expect(glyph).toContain('stroke-width="1.5"');
    expect(glyph).toContain('aria-hidden="true"');
    // Inherits the surrounding ink: no colour class of its own.
    expect(glyph).not.toMatch(/class="[^"]*text-/);
  });

  it("degrades an unknown dimension to its channel glyph, never to a blank", () => {
    // quantum-basket-weaving is not in META, so the row falls back through a
    // null channel and still draws something rather than a gap.
    const markup = render([trend("quantum-basket-weaving", [3.0, 3.5])]);
    expect(markup).toContain("data-glyph=");
  });
});

