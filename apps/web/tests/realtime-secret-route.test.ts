import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/realtime-secret mints the OpenAI ephemeral secret for one
// session. It accepts two credentials: the legacy package access token in
// the body, or — with no token — the signed-in viewer's ownership of the
// session's package. The authorization always runs BEFORE any OpenAI call,
// and the interviewer instructions always come from the worker session
// payload, never from the client.

const { getViewer, authorizeSession, authorizeViewerSession } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  authorizeSession: vi.fn(),
  authorizeViewerSession: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({ authorizeSession, authorizeViewerSession }));

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
