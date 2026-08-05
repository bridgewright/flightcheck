import { describe, expect, it } from "vitest";

import type { BarsAnchor } from "@/lib/types";

import {
  channelLabel,
  DELIVERY_RECEIPT,
  formatWeight,
  hasReceipts,
  sortedAnchors,
} from "./rubric-format";

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
    expect(channelLabel("content")).toBe("Content: what you say");
  });

  it("names the raw-audio channel", () => {
    expect(channelLabel("delivery")).toBe("Delivery: how you say it");
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

describe("hasReceipts", () => {
  // F-62. The decision "is this rubric post-F-62 at all" lives here, not in
  // the component: a pre-F-62 rubric must render byte-identical to today, so
  // the delivery line may never key on channel alone.
  const dim = (jd_evidence?: string | null) => ({ jd_evidence });

  it("is false for a rubric stored before the field existed", () => {
    // Old-shape dimensions carry no jd_evidence key at all.
    expect(hasReceipts([{}, {}])).toBe(false);
  });

  it("is false when every value is null or blank", () => {
    expect(hasReceipts([dim(null), dim(""), dim("   ")])).toBe(false);
  });

  it("is true when any one dimension carries a non-blank quote", () => {
    expect(
      hasReceipts([dim(null), dim("4+ years shipping ML products")]),
    ).toBe(true);
  });

  it("is false for no dimensions at all", () => {
    expect(hasReceipts([])).toBe(false);
  });
});

describe("DELIVERY_RECEIPT", () => {
  it("owns the bar instead of attributing it to the JD", () => {
    // Delivery is licensed by the product, not quoted from the JD, and the
    // line has to say so in as many words.
    expect(DELIVERY_RECEIPT).toContain("product");
    expect(DELIVERY_RECEIPT).toContain("JD");
    expect(DELIVERY_RECEIPT).toContain("every interview");
  });

  it("keeps the calm register: one sentence, no dashes, no exclamation", () => {
    expect(DELIVERY_RECEIPT).not.toMatch(/[–—]/);
    expect(DELIVERY_RECEIPT).not.toContain("!");
    expect(DELIVERY_RECEIPT.trim().endsWith(".")).toBe(true);
  });
});
