import { describe, expect, it } from "vitest";

import {
  formatLatency,
  formatTimestamp,
  VERDICT_LABELS,
  verdictClasses,
} from "@/lib/report-format";

describe("VERDICT_LABELS", () => {
  it("maps every verdict to honest copy", () => {
    expect(VERDICT_LABELS.not_ready).toBe("Not ready yet");
    expect(VERDICT_LABELS.approaching).toBe("Approaching");
    expect(VERDICT_LABELS.ready).toBe("Ready");
  });
});

describe("verdictClasses", () => {
  it("color-codes not_ready red, approaching amber, ready green", () => {
    expect(verdictClasses("not_ready")).toContain("red");
    expect(verdictClasses("approaching")).toContain("amber");
    expect(verdictClasses("ready")).toContain("green");
  });

  it("gives each verdict a distinct style", () => {
    const styles = new Set([
      verdictClasses("not_ready"),
      verdictClasses("approaching"),
      verdictClasses("ready"),
    ]);
    expect(styles.size).toBe(3);
  });
});

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
