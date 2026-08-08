import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The proxy is the Supabase cookie-refresh point. v0.5 adds /api/:path* to
// the matcher so API calls refresh auth cookies too — but updateSession
// redirects signed-out requests to /login, and an API caller must NEVER get
// an HTML login redirect: every /api handler does its own auth, and the
// Polar webhook is called by Polar's servers with no cookies at all. So the
// proxy strips the redirect for /api paths (cookie refresh when signed in,
// plain pass-through when not). These tests pin the matcher array itself
// (an include-list — static assets stay excluded by construction) and that
// /api behavior.

const { updateSession } = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock("../lib/supabase/middleware", () => ({ updateSession }));

import { config as proxyConfig, proxy } from "@/proxy";

const request = (path: string) => new NextRequest(`http://web.test${path}`);
const loginRedirect = (from: string) =>
  NextResponse.redirect(`http://web.test/login?next=${encodeURIComponent(from)}`);

beforeEach(() => {
  updateSession.mockReset();
});

describe("proxy matcher", () => {
  it("pins the exact matcher array, including /api/:path*", () => {
    expect(proxyConfig.matcher).toEqual([
      "/feedback",
      "/home/:path*",
      "/p/:path*",
      "/sessions/:path*",
      "/progress/:path*",
      "/ops/:path*",
      "/rubric/:path*",
      "/packages/:path*",
      "/settings/:path*",
      "/new",
      "/dev/:path*",
      "/api/:path*",
    ]);
  });

  it("stays an include-list — no catch-all that would cover static assets", () => {
    for (const entry of proxyConfig.matcher) {
      expect(entry.startsWith("/")).toBe(true);
      expect(entry).not.toBe("/:path*");
      expect(entry.startsWith("/_next")).toBe(false);
    }
  });
});

describe("proxy behavior on /api", () => {
  it("passes a signed-out API call through instead of redirecting to /login", async () => {
    updateSession.mockResolvedValue(loginRedirect("/api/webhooks/polar"));
    const response = await proxy(request("/api/webhooks/polar"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("returns the cookie-refresh response for a signed-in API call", async () => {
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-token", "refreshed");
    updateSession.mockResolvedValue(refreshed);
    const response = await proxy(request("/api/sessions"));
    expect(response).toBe(refreshed);
  });

  it("still redirects a signed-out PAGE request to /login", async () => {
    updateSession.mockResolvedValue(loginRedirect("/home"));
    const response = await proxy(request("/home"));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toContain("/login");
  });
});
