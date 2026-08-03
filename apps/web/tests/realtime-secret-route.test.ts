import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/realtime-secret mints the OpenAI ephemeral secret for one
// session. It accepts two credentials: the legacy package access token in
// the body, or — with no token — the signed-in viewer's ownership of the
// session's package. The authorization always runs BEFORE any OpenAI call,
// and the interviewer instructions always come from the worker session
// payload, never from the client.

const {
  getViewer,
  authorizeSession,
  authorizeViewerSession,
  incrementSecretMint,
  FakeWorkerError,
} = vi.hoisted(() => {
  // Stands in for lib/worker's WorkerError: the route discriminates the
  // mint-cap 429 with instanceof, so the mocked module must export the same
  // class the tests construct rejections from.
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

import { POST } from "@/app/api/realtime-secret/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/realtime-secret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SESSION_WITH_INSTRUCTIONS = {
  id: "sess-1",
  package_id: "pkg-1",
  index: 1,
  interviewer_instructions: "You are Morgan…",
};

const fetchMock = vi.fn();

beforeEach(() => {
  getViewer.mockReset();
  authorizeSession.mockReset();
  authorizeViewerSession.mockReset();
  incrementSecretMint.mockReset();
  incrementSecretMint.mockResolvedValue(1);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ value: "ek_test", expires_at: 1234 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/realtime-secret input validation", () => {
  it("rejects a body without sessionId", async () => {
    const res = await POST(jsonRequest({ token: "tok-1" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/realtime-secret with the legacy access token", () => {
  it("mints a secret after the token authorization", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS },
    });
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "ek_test", expiresAt: 1234 });
    expect(authorizeSession).toHaveBeenCalledWith("tok-1", "sess-1");
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("denies before any OpenAI call", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("POST /api/realtime-secret with viewer ownership (no token)", () => {
  it("rejects an anonymous caller with 401 before any worker or OpenAI call", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(401);
    expect(authorizeViewerSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a secret when the viewer owns the session's package", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS, pkg: { id: "pkg-1" } },
    });
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "ek_test", expiresAt: 1234 });
    expect(authorizeViewerSession).toHaveBeenCalledWith(
      { id: "viewer-1", email: null },
      "sess-1",
    );
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("maps a foreign session to 403 without an OpenAI call", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("maps a worker outage to 502, not a denial", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 502 });
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(502);
    errorSpy.mockRestore();
  });
});

// v0.5 per-session connection cap: every mint is counted against the
// session BEFORE OpenAI is called, so a stolen link cannot mint secrets
// forever. Over the cap the worker answers 429 and the route forwards it
// honestly; every other counter failure lets the mint proceed — the cap is
// an abuse guard, not a availability dependency for real interviews.
describe("POST /api/realtime-secret mint counting", () => {
  it("counts the mint against the session before calling OpenAI", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS },
    });
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(200);
    expect(incrementSecretMint).toHaveBeenCalledWith("sess-1");
    expect(incrementSecretMint.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );
  });

  it("answers an honest 429 over the cap, without any OpenAI call", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS },
    });
    incrementSecretMint.mockRejectedValue(new FakeWorkerError(429, "mint-cap"));
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(429);
    expect((await res.json()) as { error: string }).toEqual({
      error: "Too many connection attempts for this session.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still mints when the counter call cannot reach the worker", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS },
    });
    incrementSecretMint.mockRejectedValue(new Error("fetch failed"));
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "ek_test", expiresAt: 1234 });
    errorSpy.mockRestore();
  });

  it("treats a non-429 worker refusal like an outage — the mint proceeds", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS },
    });
    // e.g. a deployed worker that predates the secret-mint endpoint (404).
    incrementSecretMint.mockRejectedValue(new FakeWorkerError(404, "unknown"));
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(200);
    errorSpy.mockRestore();
  });

  it("never touches the counter for an unauthorized caller", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(403);
    expect(incrementSecretMint).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not count a mint when the session has no instructions to mint for", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: { ...SESSION_WITH_INSTRUCTIONS, interviewer_instructions: "" } },
    });
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(502);
    expect(incrementSecretMint).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("POST /api/realtime-secret instruction handling", () => {
  it("502s when the worker payload has no interviewer instructions", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: {
        session: { ...SESSION_WITH_INSTRUCTIONS, interviewer_instructions: "" },
        pkg: { id: "pkg-1" },
      },
    });
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("502s when the OpenAI mint fails, without echoing the OpenAI body", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION_WITH_INSTRUCTIONS },
    });
    fetchMock.mockResolvedValue(
      new Response("upstream secret detail", { status: 401 }),
    );
    const res = await POST(jsonRequest({ sessionId: "sess-1", token: "tok-1" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("upstream secret detail");
    errorSpy.mockRestore();
  });
});
