import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { googleAuthEnabled } from "@/app/login/google-auth";
import { safeNextPath } from "@/lib/auth-redirect";

// F-44 ships as code only: the Google Cloud OAuth client and the Supabase
// provider are console work, and live end-to-end sign-in stays a user-side
// check. What CAN be verified from here is everything between the flag and
// the session — and that is what this file covers, so that turning the flag
// on is not the first time any of it runs.

describe("googleAuthEnabled", () => {
  it("enables only on an explicit true", () => {
    expect(googleAuthEnabled("true")).toBe(true);
    expect(googleAuthEnabled("TRUE")).toBe(true);
    expect(googleAuthEnabled(" true ")).toBe(true);
  });

  it("stays off for anything else, including near-misses", () => {
    // The failure this guards: a button that dead-ends on a raw provider
    // error page because the OAuth client was never actually configured. A
    // lenient parse is how that ships by accident.
    for (const raw of [undefined, "", " ", "1", "yes", "on", "false", "ture"]) {
      expect(googleAuthEnabled(raw), String(raw)).toBe(false);
    }
  });
});

describe("the login screen's Google path", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../app/login/page.tsx", import.meta.url)),
    "utf8",
  );

  it("renders the button from the flag, never a literal", () => {
    expect(source).toContain("GOOGLE_AUTH_ENABLED");
    expect(source).not.toMatch(/GOOGLE_AUTH_ENABLED\s*=\s*(?:true|false)/);
  });

  it("keeps the OAuth call compiled whether or not the button shows", () => {
    // Only the button is conditional. signInWithOAuth, the callback URL, and
    // the error surface stay in the bundle and stay typechecked.
    expect(source).toContain("signInWithOAuth");
    expect(source).toContain('provider: "google"');
    expect(source).toContain("redirectTo: callbackUrl()");
  });

  it("sends the provider back through this app's own callback", () => {
    expect(source).toContain("/auth/callback?next=");
    // The next path is encoded before it goes into the redirect URL.
    expect(source).toContain("encodeURIComponent(nextPath)");
  });

  it("routes an OAuth failure to the same visible error slot as email", () => {
    expect(source).toContain("setError(authError.message)");
  });
});

// --- the callback both sign-in methods land on --------------------------

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

vi.mock("next/headers", () => ({ cookies: async () => new Map() }));

import { GET } from "@/app/auth/callback/route";

const callback = (query: string) =>
  new Request(`https://flightcheck.test/auth/callback${query}`);

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("exchanges the code and lands the user where they were going", async () => {
    const response = await GET(callback("?code=abc123&next=/progress"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://flightcheck.test/progress");
  });

  it("defaults to the signed-in home when no destination was carried", async () => {
    const response = await GET(callback("?code=abc123"));
    expect(response.headers.get("location")).toBe("https://flightcheck.test/home");
  });

  it("sends a failed exchange to the login screen with an honest marker", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: new Error("expired") });
    const response = await GET(callback("?code=stale"));
    expect(response.headers.get("location")).toBe(
      "https://flightcheck.test/login?error=auth",
    );
  });

  it("refuses to exchange when the provider sent no code", async () => {
    // The OAuth error path (user cancels at Google's consent screen) arrives
    // here with ?error=access_denied and no code.
    const response = await GET(callback("?error=access_denied"));
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://flightcheck.test/login?error=auth",
    );
  });

  it("never redirects off-origin, whatever `next` claims", async () => {
    // The open-redirect this shares with the email link: a crafted callback
    // URL must not be able to bounce a freshly authenticated user to an
    // attacker's page.
    for (const hostile of [
      "//evil.example",
      "https://evil.example/steal",
      "/\\evil.example",
      "/\tevil",
    ]) {
      const response = await GET(
        callback(`?code=abc123&next=${encodeURIComponent(hostile)}`),
      );
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.origin).toBe("https://flightcheck.test");
      expect(safeNextPath(hostile)).toBe("/home");
    }
  });
});
