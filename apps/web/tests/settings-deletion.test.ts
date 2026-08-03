import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-scan contract for the settings deletion intake (no render harness —
// same pattern as token-in-href.test.ts). Deletion v0.5 is a manual mailto
// process; what must not drift is that the section exists, the mailto comes
// from the shared policy helper (prefilled subject + account address), and
// the copy states the timeline from the same module the privacy page reads.

const source = readFileSync(
  fileURLToPath(new URL("../app/settings/page.tsx", import.meta.url)),
  "utf8",
);

describe("settings deletion intake", () => {
  it("has the Delete account & data section", () => {
    expect(source).toContain("Delete account");
  });

  it("builds the intake link with the shared deletionMailto helper", () => {
    expect(source).toContain("deletionMailto");
  });

  it("states the manual-process timeline from the policy module", () => {
    expect(source).toContain("DELETION_TIMELINE_DAYS");
  });
});
