import { describe, expect, it } from "vitest";

import {
  formatLatency,
  formatTimestamp,
  scoringStageCopy,
  VERDICT_LABELS,
} from "@/lib/report-format";

describe("VERDICT_LABELS", () => {
  it("maps every verdict to honest copy", () => {
    expect(VERDICT_LABELS.not_ready).toBe("Not yet ready");
    expect(VERDICT_LABELS.approaching).toBe("Approaching");
    expect(VERDICT_LABELS.ready).toBe("Ready");
  });
});

// The verdictClasses suite lived here and pinned "not_ready is red,
// approaching is amber, ready is green". Both the helper and the suite are
// gone: the verdict is no longer a traffic light. Colour-coded certainty is
// on the competitive dossier's AVOID list, and rendering "Not yet ready" in
// red punishes the reader this product exists for. The verdict is carried by
// scale, position, and the threshold printed on the gauge, and sage marks
// Ready alone. See lib/verdict.ts and tests/verdict-single-source.test.ts.

describe("formatTimestamp", () => {
  it("formats seconds as zero-padded mm:ss", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(252)).toBe("04:12");
  });

  it("floors fractional seconds", () => {
    expect(formatTimestamp(61.9)).toBe("01:01");
  });

  it("lets minutes exceed 59 rather than rolling into hours", () => {
    expect(formatTimestamp(3721)).toBe("62:01");
  });
});

describe("formatLatency", () => {
  it("renders one decimal with a unit, and n/a for null", () => {
    expect(formatLatency(1.42)).toBe("1.4s");
    expect(formatLatency(null)).toBe("n/a");
  });
});

describe("scoringStageCopy", () => {
  it("maps every worker scoring stage to progress copy", () => {
    expect(scoringStageCopy("download")).toBe("Fetching your recording…");
    expect(scoringStageCopy("transcribe")).toBe("Transcribing the conversation…");
    expect(scoringStageCopy("delivery-metrics")).toBe(
      "Measuring pace, fillers, and intonation…",
    );
    expect(scoringStageCopy("content-judge")).toBe(
      "Scoring answers against the rubric…",
    );
    expect(scoringStageCopy("delivery-judge")).toBe("Reviewing how it sounded…");
    expect(scoringStageCopy("compile")).toBe("Compiling your report…");
  });

  it("returns null for null, undefined, and unknown stages so the page keeps its generic line", () => {
    expect(scoringStageCopy(null)).toBeNull();
    expect(scoringStageCopy(undefined)).toBeNull();
    expect(scoringStageCopy("mystery-stage")).toBeNull();
  });
});
