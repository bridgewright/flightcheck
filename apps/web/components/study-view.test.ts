import { describe, expect, it } from "vitest";
import { sessionHeading, studyExportFilename } from "@/components/study-view";

describe("study display derivations", () => {
  it("formats session and export names", () => {
    expect(sessionHeading(2)).toBe("Session 02");
    expect(studyExportFilename("2026-08-08T12:00:00Z")).toBe("flightcheck-study-2026-08-08");
  });
});
