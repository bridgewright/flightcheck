import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, authorizeViewerSession, heartbeatSession, reclaimSession } =
  vi.hoisted(() => ({
    getViewer: vi.fn(),
    authorizeViewerSession: vi.fn(),
    heartbeatSession: vi.fn(),
    reclaimSession: vi.fn(),
  }));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worker")>()),
  authorizeViewerSession,
  heartbeatSession,
  reclaimSession,
}));

import { POST as heartbeat } from "@/app/api/sessions/[id]/heartbeat/route";
import { POST as reclaim } from "@/app/api/sessions/[id]/reclaim/route";

const request = new Request("http://web.test", { method: "POST" });
const context = { params: Promise.resolve({ id: "sess-1" }) };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("session heartbeat route", () => {
  it("requires a signed-in owner", async () => {
    getViewer.mockResolvedValue(null);
    expect((await heartbeat(request, context)).status).toBe(401);
    expect(heartbeatSession).not.toHaveBeenCalled();
  });

  it("beats only after session ownership is proved", async () => {
    const viewer = { id: "owner-1", email: null };
    getViewer.mockResolvedValue(viewer);
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: { package_id: "pkg-1" } },
    });
    heartbeatSession.mockResolvedValue(undefined);
    expect((await heartbeat(request, context)).status).toBe(200);
    expect(authorizeViewerSession).toHaveBeenCalledWith(viewer, "sess-1");
    // A bodyless beat carries no diagnostics — the pre-072 contract.
    expect(heartbeatSession).toHaveBeenCalledWith("sess-1", undefined);
  });

  it("forwards a diagnostics delta to the worker (DECISIONS 072)", async () => {
    getViewer.mockResolvedValue({ id: "owner-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: { package_id: "pkg-1" } },
    });
    heartbeatSession.mockResolvedValue(undefined);
    const withDelta = new Request("http://web.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ diagnostics: "100ms greeting-sent" }),
    });
    expect((await heartbeat(withDelta, context)).status).toBe(200);
    expect(heartbeatSession).toHaveBeenCalledWith(
      "sess-1",
      "100ms greeting-sent",
    );
  });

  it("degrades anything malformed to the plain beat, never to a refusal", async () => {
    getViewer.mockResolvedValue({ id: "owner-1", email: null });
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: { package_id: "pkg-1" } },
    });
    heartbeatSession.mockResolvedValue(undefined);
    for (const body of ["not json{", JSON.stringify({ diagnostics: 42 }), JSON.stringify({ diagnostics: "" })]) {
      const malformed = new Request("http://web.test", { method: "POST", body });
      expect((await heartbeat(malformed, context)).status).toBe(200);
    }
    for (const call of heartbeatSession.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });
});

describe("session reclaim route", () => {
  it("does not reveal a foreign session", async () => {
    getViewer.mockResolvedValue({ id: "owner-1", email: null });
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 403 });
    expect((await reclaim(request, context)).status).toBe(403);
    expect(reclaimSession).not.toHaveBeenCalled();
  });

  it("binds reclaim to the owner and the session package", async () => {
    const viewer = { id: "owner-1", email: null };
    getViewer.mockResolvedValue(viewer);
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: { session: { package_id: "pkg-1" } },
    });
    reclaimSession.mockResolvedValue(undefined);
    expect((await reclaim(request, context)).status).toBe(200);
    expect(reclaimSession).toHaveBeenCalledWith("sess-1", "pkg-1", "owner-1");
  });
});
