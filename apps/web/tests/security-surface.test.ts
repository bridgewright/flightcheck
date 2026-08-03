import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ROOM_PATH_SOURCE,
  TOKEN_LINK_SOURCE,
  securityHeaderRules,
} from "@/lib/security-headers";

// Two gates that lib-level unit tests cannot reach: that the header rules
// still point at routes that exist, and that the secret mint refuses a
// session whose capability window has closed.

const repoPath = (path: string) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url));

describe("the header rules point at real routes", () => {
  it("the microphone exception matches the room page that exists", () => {
    // If the room moves, the Permissions-Policy override silently stops
    // applying and getUserMedia fails with a policy error that looks like a
    // browser bug. This is the only thing that would catch it.
    expect(ROOM_PATH_SOURCE).toBe("/sessions/:id/room");
    expect(existsSync(repoPath("app/sessions/[id]/room/page.tsx"))).toBe(true);
  });

  it("the no-referrer rule matches the token-bearing share links", () => {
    expect(TOKEN_LINK_SOURCE).toBe("/p/:path*");
    expect(existsSync(repoPath("app/p/[token]/page.tsx"))).toBe(true);
  });

  it("every rule carries at least one header", () => {
    for (const rule of securityHeaderRules({
      isDev: false,
      supabaseOrigin: "https://project.supabase.co",
      sentryOrigins: [],
    })) {
      expect(rule.headers.length).toBeGreaterThan(0);
    }
  });
});

// --- the secret mint honours revocation ----------------------------------

const {
  getViewer,
  authorizeSession,
  authorizeViewerSession,
  incrementSecretMint,
  FakeWorkerError,
} = vi.hoisted(() => {
  class FakeWorkerError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string) {
      super(`worker POST secret-mint failed: ${status}`);
      this.name = "WorkerError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    getViewer: vi.fn(),
    authorizeSession: vi.fn(),
    authorizeViewerSession: vi.fn(),
    incrementSecretMint: vi.fn(),
    FakeWorkerError,
  };
});

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  authorizeSession,
  authorizeViewerSession,
  incrementSecretMint,
  WorkerError: FakeWorkerError,
}));

const { POST } = await import("@/app/api/realtime-secret/route");

const fetchMock = vi.fn();

function request(body: unknown): Request {
  return new Request("http://web.test/api/realtime-secret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function session(extra: Record<string, unknown>) {
  return {
    ok: true,
    value: {
      pkg: { id: "pkg-1" },
      session: {
        id: "sess-1",
        package_id: "pkg-1",
        index: 1,
        interviewer_instructions: "be Morgan",
        ...extra,
      },
    },
  };
}

beforeEach(() => {
  getViewer.mockReset();
  authorizeSession.mockReset();
  authorizeViewerSession.mockReset();
  incrementSecretMint.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  getViewer.mockResolvedValue({ id: "user-1" });
  incrementSecretMint.mockResolvedValue(1);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ value: "ek_x", expires_at: 1 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

describe("POST /api/realtime-secret capability gate", () => {
  it("mints for a session with an open window", async () => {
    authorizeViewerSession.mockResolvedValue(
      session({ access_token_expires_at: "2999-01-01T00:00:00Z" }),
    );
    const res = await POST(request({ sessionId: "sess-1" }));
    expect(res.status).toBe(200);
  });

  it("mints for a session with neither column set (pre-006 rows)", async () => {
    authorizeViewerSession.mockResolvedValue(session({}));
    expect((await POST(request({ sessionId: "sess-1" }))).status).toBe(200);
  });

  it("refuses a revoked session before OpenAI is called", async () => {
    authorizeViewerSession.mockResolvedValue(
      session({ token_revoked_at: "2026-01-01T00:00:00Z" }),
    );
    const res = await POST(request({ sessionId: "sess-1" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    // And the mint counter must not move for a request that was refused.
    expect(incrementSecretMint).not.toHaveBeenCalled();
  });

  it("refuses an expired session", async () => {
    authorizeViewerSession.mockResolvedValue(
      session({ access_token_expires_at: "2000-01-01T00:00:00Z" }),
    );
    expect((await POST(request({ sessionId: "sess-1" }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies to the legacy token credential too", async () => {
    // Revocation is a property of the session, not of the credential used
    // to reach it — otherwise the old token link would be a way around it.
    authorizeSession.mockResolvedValue(
      session({ token_revoked_at: "2026-01-01T00:00:00Z" }),
    );
    const res = await POST(request({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says nothing about which session or why", async () => {
    authorizeViewerSession.mockResolvedValue(
      session({ token_revoked_at: "2026-01-01T00:00:00Z" }),
    );
    const body = await (await POST(request({ sessionId: "sess-1" }))).json();
    expect(body).toEqual({ error: "access denied" });
  });
});
