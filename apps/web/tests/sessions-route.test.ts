import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/sessions/[id] {action: "complete"} accepts two credentials:
// the legacy package access token in the body, or — with no token — the
// signed-in viewer's ownership of the session's package. Either way the
// recording's storage path is derived server-side from the authorized
// session row, never accepted from the client.

const { getViewer, authorizeSession, authorizeViewerSession, completeSession, list } =
  vi.hoisted(() => ({
    getViewer: vi.fn(),
    authorizeSession: vi.fn(),
    authorizeViewerSession: vi.fn(),
    completeSession: vi.fn(),
    list: vi.fn(),
  }));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  authorizeSession,
  authorizeViewerSession,
  completeSession,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => ({ list }) } }),
}));

import * as route from "@/app/api/sessions/[id]/route";

const { POST } = route;

function completeRequest(body: unknown): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request("http://web.test/api/sessions/sess-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "sess-1" }) },
  ];
}

const SESSION = { id: "sess-1", package_id: "11111111-2222-4333-8444-555555555555", index: 2 };

beforeEach(() => {
  getViewer.mockReset();
  authorizeSession.mockReset();
  authorizeViewerSession.mockReset();
  completeSession.mockReset();
  list.mockReset();
  vi.restoreAllMocks();
  // Default: an ordinary recording, well under the cap.
  list.mockResolvedValue({ data: [{ metadata: { size: 4 * 1024 * 1024 } }], error: null });
});

describe("session route exposes no unauthenticated GET", () => {
  it("exports POST and does not export GET", () => {
    expect(typeof route.POST).toBe("function");
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe("POST /api/sessions/[id] complete with the legacy access token", () => {
  it("completes a quick session without probing storage", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id, kind: "quick" } },
    });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(202);
    expect(list).toHaveBeenCalledTimes(0);
  });

  it("probes a standard session and refuses an oversize recording", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id, kind: "standard" } },
    });
    list.mockResolvedValue({
      data: [{ metadata: { size: 61 * 1024 * 1024 } }],
      error: null,
    });
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(413);
    expect(list).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("treats an absent package kind as standard", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(202);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("completes with the server-derived storage path", async () => {
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(202);
    expect(authorizeSession).toHaveBeenCalledWith("tok-1", "sess-1");
    expect(completeSession).toHaveBeenCalledWith(
      "sess-1",
      `packages/${SESSION.package_id}/session-2.webm`,
    );
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("passes the worker's already-scored refusal through as 409", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    completeSession.mockResolvedValue("already-scored");
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(409);
    errorSpy.mockRestore();
  });

  it("maps a denial to 403", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(403);
    expect(completeSession).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("POST /api/sessions/[id] complete with viewer ownership (no token)", () => {
  it("rejects an anonymous caller with 401 before any worker call", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(401);
    expect(authorizeViewerSession).not.toHaveBeenCalled();
    expect(completeSession).not.toHaveBeenCalled();
  });

  it("completes when the viewer owns the session's package", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(202);
    expect(authorizeViewerSession).toHaveBeenCalledWith(
      { id: "viewer-1", email: null },
      "sess-1",
    );
    expect(completeSession).toHaveBeenCalledWith(
      "sess-1",
      `packages/${SESSION.package_id}/session-2.webm`,
    );
    expect(authorizeSession).not.toHaveBeenCalled();
  });

  it("completes a quick session without probing storage", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id, kind: "quick" } },
    });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(202);
    expect(list).toHaveBeenCalledTimes(0);
  });

  it("probes a standard session and refuses an oversize recording", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id, kind: "standard" } },
    });
    list.mockResolvedValue({
      data: [{ metadata: { size: 61 * 1024 * 1024 } }],
      error: null,
    });
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(413);
    expect(list).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("treats an absent package kind as standard", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(202);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("maps a foreign session to 403 without revealing whether it exists", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(403);
    expect(completeSession).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("maps a worker outage to 502, not a denial", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 502 });
    const res = await POST(...completeRequest({ action: "complete" }));
    expect(res.status).toBe(502);
    errorSpy.mockRestore();
  });
});

// The blob goes straight from the browser to Supabase Storage, so the only
// server checkpoint that sees a real byte count is this one — after the
// upload, before the scoring spend.
describe("POST /api/sessions/[id] complete enforces the stored recording cap", () => {
  it("refuses to score an oversize recording", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    list.mockResolvedValue({
      data: [{ metadata: { size: 61 * 1024 * 1024 } }],
      error: null,
    });
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(413);
    expect(completeSession).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith(`packages/${SESSION.package_id}`, {
      search: "session-2.webm",
      limit: 1,
    });
    errorSpy.mockRestore();
  });

  it("scores anyway when the size cannot be read", async () => {
    // Fail-open on purpose: the interview is already over and cannot be
    // redone, so a storage hiccup must not cost the customer their session.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizeSession.mockResolvedValue({
      ok: true,
      value: { session: SESSION, pkg: { id: SESSION.package_id } },
    });
    list.mockResolvedValue({ data: null, error: { message: "listing unavailable" } });
    completeSession.mockResolvedValue("accepted");
    const res = await POST(...completeRequest({ action: "complete", token: "tok-1" }));
    expect(res.status).toBe(202);
    expect(completeSession).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
