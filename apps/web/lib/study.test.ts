// The copy and formatting the study page derives from a study document.
// The state machine itself is pinned in tests/study-page-gate.test.ts; this
// file covers the sentences the customer actually reads.
import { describe, expect, it } from "vitest";

import { formatGeneratedAt, staleLine } from "@/lib/study";

describe("formatGeneratedAt", () => {
  it("renders a readable date rather than an ISO string", () => {
    expect(formatGeneratedAt("2026-08-08T00:00:00Z")).toBe("Aug 8, 2026");
  });

  it("reads the instant in UTC, not the server's zone", () => {
    // Without the pinned zone this date moves by one day depending on where
    // the container happens to run, and two customers comparing screenshots
    // of the same guide see different dates.
    expect(formatGeneratedAt("2026-08-08T23:30:00Z")).toBe("Aug 8, 2026");
    expect(formatGeneratedAt("2026-08-09T00:30:00Z")).toBe("Aug 9, 2026");
  });

  it("says so plainly when the stamp is unreadable", () => {
    // A row written by an older worker, or a column that came back null and
    // was coerced. Never "Invalid Date" on a customer's screen.
    expect(formatGeneratedAt("not a date")).toBe("Unknown date");
    expect(formatGeneratedAt("")).toBe("Unknown date");
  });
});

describe("staleLine", () => {
  it("says when the guide was built and what has happened since", () => {
    const line = staleLine("2026-08-08T00:00:00Z", 4);

    expect(line).toContain("Aug 8, 2026");
    expect(line).toContain("4 scored sessions");
  });

  it("counts one session in the singular", () => {
    // The banner appears the moment a single new session is scored, so the
    // singular is the common case rather than the rare one.
    const line = staleLine("2026-08-08T00:00:00Z", 1);

    expect(line).toContain("1 scored session");
    expect(line).not.toContain("1 scored sessions");
  });

  it("explains rather than alarms", () => {
    // A stale guide is still a true guide. This line sits above content the
    // customer can use today, so it must not read as an error.
    const line = staleLine("2026-08-08T00:00:00Z", 2);

    expect(line.toLowerCase()).not.toContain("error");
    expect(line.toLowerCase()).not.toContain("invalid");
    expect(line.toLowerCase()).not.toContain("out of date");
  });
});
