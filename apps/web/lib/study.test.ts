import { describe, expect, it } from "vitest";
import { formatGeneratedAt, staleLine, studyState } from "@/lib/study";

describe("study state", () => {
  it("pins empty and worker-down states", () => {
    expect(studyState(null, 0)).toBe("no_sessions");
    expect(studyState(null, 1)).toBe("not_generated");
  });
  it("formats stale copy", () => {
    expect(formatGeneratedAt("2026-08-08T00:00:00Z")).toContain("2026");
    expect(staleLine("2026-08-08T00:00:00Z", 2)).toContain("2 scored sessions");
  });
});
