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

  it("always offers the account chooser (DECISIONS 073)", () => {
    // Without a prompt parameter, a returning consented customer gets a
    // silent bounce that picks an account for them — the wrong-account
    // trap. GoTrue forwards queryParams to the authorize URL untouched.
    expect(source).toMatch(
      /queryParams:\s*\{\s*prompt:\s*"select_account"\s*\}/,
    );
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

describe("the Google mark on the button", () => {
  const svg = readFileSync(
    fileURLToPath(new URL("../public/google-g.svg", import.meta.url)),
    "utf8",
  );

  it("is on the button, and is not information a screen reader repeats", () => {
    expect(source).toContain('src="/google-g.svg"');
    expect(source).toContain('alt=""');
  });

  it("keeps Google's four colours exactly", () => {
    // Google's mark may not be recoloured. That is why it is an asset rather
    // than a token: the colour scan over app, components and lib would reject
    // these as raw literals, and it would be right to. This is the check that
    // stops a well-meaning pass from tinting them to the palette.
    const fills = [...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) =>
      m[1].toUpperCase(),
    );
    expect(new Set(fills)).toEqual(
      new Set(["#EA4335", "#4285F4", "#FBBC05", "#34A853"]),
    );
  });

  it("is well-formed enough to render", () => {
    // hero-bloom.svg served a clean 200 and painted nothing three times over,
    // because a double hyphen inside an XML comment is a parse error. Same
    // check here rather than the same afternoon again.
    for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(body).not.toContain("--");
    }
    expect(svg).toMatch(/viewBox=/);
    expect(svg).toMatch(/\bwidth="\d+"/);
    expect(svg).toMatch(/\bheight="\d+"/);
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
