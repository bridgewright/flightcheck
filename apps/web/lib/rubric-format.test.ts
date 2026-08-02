import { describe, expect, it } from "vitest";

import type { BarsAnchor } from "@/lib/types";

import { channelLabel, formatWeight, sortedAnchors } from "./rubric-format";

describe("formatWeight", () => {
  it("renders a fraction as a whole percentage", () => {
    expect(formatWeight(0.3)).toBe("30%");
    expect(formatWeight(0.05)).toBe("5%");
  });

  it("rounds instead of truncating", () => {
    expect(formatWeight(0.125)).toBe("13%");
    // Weights compiled as thirds must not render as 33.33333%.
    expect(formatWeight(1 / 3)).toBe("33%");
  });
});

describe("channelLabel", () => {
  it("names the transcript channel", () => {
    expect(channelLabel("content")).toBe("Content — what you say");
  });

  it("names the raw-audio channel", () => {
    expect(channelLabel("delivery")).toBe("Delivery — how you say it");
  });
});

describe("sortedAnchors", () => {
  const anchors: BarsAnchor[] = [
    { score: 1, behavior: "Reads generic answers." },
    { score: 5, behavior: "Owns the room." },
    { score: 3, behavior: "Solid but unspecific." },
  ];

  it("orders top score first — the bar leads", () => {
    expect(sortedAnchors(anchors).map((a) => a.score)).toEqual([5, 3, 1]);
  });

  it("does not mutate the rubric's own array", () => {
    const copy = [...anchors];
    sortedAnchors(anchors);
    expect(anchors).toEqual(copy);
  });
});
