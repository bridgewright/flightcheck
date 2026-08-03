import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-scan contract for the login screen (no render harness — same
// pattern as token-in-href.test.ts): the consent line must link both legal
// documents, and the sent state must carry the spam-folder hint and the
// cooldown-gated resend from lib/resend-cooldown.ts.

const source = readFileSync(
  fileURLToPath(new URL("../app/login/page.tsx", import.meta.url)),
  "utf8",
);

describe("login page consent line", () => {
  it("states the agreement in the required words", () => {
    expect(source).toContain("By continuing you agree to the");
  });

  it("links the Terms and the Privacy Policy", () => {
    expect(source).toContain('"/legal/terms"');
    expect(source).toContain('"/legal/privacy"');
  });
});

describe("login page sent state", () => {
  it("tells the user to check the spam folder", () => {
    expect(source).toContain("spam folder");
  });

  it("gates the resend behind the shared cooldown logic", () => {
    expect(source).toContain("remainingCooldown");
    expect(source).toContain("resendLabel");
  });
});
