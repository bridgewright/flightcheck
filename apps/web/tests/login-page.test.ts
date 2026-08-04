import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-scan contract for the login screen (no render harness — same
// pattern as token-in-href.test.ts). Since DECISIONS 036 the screen has one
// door, so the contract is mostly about what is NOT there: an email field, an
// OTP call, or any other way in that this product no longer supports.

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

describe("login page sign-in path", () => {
  it("signs in with Google", () => {
    expect(source).toContain("signInWithOAuth");
    expect(source).toContain('provider: "google"');
  });

  it("returns the visitor to where they were headed", () => {
    expect(source).toContain("safeNextPath");
    expect(source).toContain("/auth/callback?next=");
  });

  it("offers the button unconditionally", () => {
    // The button used to sit behind NEXT_PUBLIC_GOOGLE_AUTH_ENABLED, which
    // existed because the provider was not configured. It is, so the flag is
    // gone and the screen may not grow another one: a conditional sign-in
    // button is how a login screen ships with no way in.
    expect(source).not.toContain("GOOGLE_AUTH_ENABLED");
    expect(source).not.toMatch(/process\.env/);
  });

  it("keeps the provider's own error text off the screen", () => {
    expect(source).not.toContain("authError.message");
  });
});

describe("login page no longer offers an email link", () => {
  it("makes no OTP call", () => {
    expect(source).not.toContain("signInWithOtp");
  });

  it("has no email field", () => {
    expect(source).not.toContain('type="email"');
    expect(source).not.toContain("autoComplete=\"email\"");
  });

  it("carries no resend cooldown", () => {
    expect(source).not.toContain("remainingCooldown");
    expect(source).not.toContain("resendLabel");
  });
});
