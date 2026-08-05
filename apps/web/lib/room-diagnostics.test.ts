import { describe, expect, it } from "vitest";

import {
  DIAG_CAPACITY,
  DIAG_DISCLOSURE_LABEL,
  formatDiagTrail,
  recordDiag,
  type DiagEntry,
} from "./room-diagnostics";

// F-67/F-68 instrumentation, the pure half. The room keeps a ring buffer of
// realtime turn events and start-sequence breadcrumbs so a misfired
// greeting or a start that dies before minting leaves a readable trail
// instead of a shrug. Measure first: this module records and formats, and
// changes nothing about timing or behavior.

describe("recordDiag", () => {
  it("appends entries in arrival order", () => {
    const buf: DiagEntry[] = [];
    recordDiag(buf, 0, "start-clicked");
    recordDiag(buf, 120, "gum-begin");
    recordDiag(buf, 300, "gum-ok");
    expect(buf.map((e) => e.tag)).toEqual([
      "start-clicked",
      "gum-begin",
      "gum-ok",
    ]);
  });

  it("keeps a note when one is given and an empty string when not", () => {
    const buf: DiagEntry[] = [];
    recordDiag(buf, 0, "gum-fail", "NotAllowedError");
    recordDiag(buf, 1, "cand-start");
    expect(buf[0].note).toBe("NotAllowedError");
    expect(buf[1].note).toBe("");
  });

  it("drops the oldest entry past capacity, never the newest", () => {
    const buf: DiagEntry[] = [];
    for (let i = 0; i < DIAG_CAPACITY + 5; i += 1) {
      recordDiag(buf, i, `ev-${i}`);
    }
    expect(buf).toHaveLength(DIAG_CAPACITY);
    expect(buf[0].tag).toBe("ev-5");
    expect(buf[buf.length - 1].tag).toBe(`ev-${DIAG_CAPACITY + 4}`);
  });
});

describe("formatDiagTrail", () => {
  it("renders one line per entry as elapsed seconds, tag, note", () => {
    const buf: DiagEntry[] = [];
    recordDiag(buf, 0, "start-clicked");
    recordDiag(buf, 1730, "gum-ok");
    recordDiag(buf, 2500, "gum-fail", "NotFoundError");
    expect(formatDiagTrail(buf)).toBe(
      "0.0s start-clicked\n1.7s gum-ok\n2.5s gum-fail NotFoundError",
    );
  });

  it("is empty for an empty buffer", () => {
    expect(formatDiagTrail([])).toBe("");
  });

  it("measures from the first entry, not from an absolute clock", () => {
    const buf: DiagEntry[] = [];
    recordDiag(buf, 10_000, "dc-open");
    recordDiag(buf, 10_900, "greeting-sent");
    expect(formatDiagTrail(buf)).toBe("0.0s dc-open\n0.9s greeting-sent");
  });
});

describe("the disclosure label", () => {
  it("is one plain word with no dashes", () => {
    expect(DIAG_DISCLOSURE_LABEL).toBe("Diagnostics");
    expect(DIAG_DISCLOSURE_LABEL).not.toMatch(/[–—]/);
  });
});
