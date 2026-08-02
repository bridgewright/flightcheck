import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/sessions accepts two credentials, tried in this order:
//
// 1. Legacy capability: the package access token in the body (the v0.1
//    model). Still honored so old links keep working until F-10 retires
//    loose tokens.
// 2. Viewer ownership: no token, but a signed-in account that owns the
//    package. This is the canonical path for the id-routed screens — the
//    browser never needs to see the token at all.
//
// Either way the response is {session_id} ONLY: session_plan and
// interviewer_instructions are the answer key of the interview and must
// never reach the browser.

const { getViewer, authorizePackage, createSession, listPackagesForUser } =
  vi.hoisted(() => ({
    getViewer: vi.fn(),
    authorizePackage: vi.fn(),
    createSession: vi.fn(),
    listPackagesForUser: vi.fn(),
  }));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  authorizePackage,
  createSession,
  listPackagesForUser,
}));

import { POST } from "@/app/api/sessions/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CREATED = {
  session_id: "sess-1",
  session_plan: { secret: "question sequence" },
  interviewer_instructions: "secret instructions",
};

beforeEach(() => {
  getViewer.mockReset();
  authorizePackage.mockReset();
  createSession.mockReset();
  listPackagesForUser.mockReset();
  vi.restoreAllMocks();
});

describe("POST /api/sessions input validation", () => {
  it("rejects a non-JSON body", async () => {
    const res = await POST(
      new Request("http://web.test/api/sessions", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a body without package_id", async () => {
    const res = await POST(jsonRequest({ token: "tok-1" }));
    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions with the legacy access token", () => {
  it("creates the session and strips the plan and instructions", async () => {
    authorizePackage.mockResolvedValue({ ok: true, value: { id: "pkg-1" } });
    createSession.mockResolvedValue(CREATED);
    const res = await POST(jsonRequest({ package_id: "pkg-1", token: "tok-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session_id: "sess-1" });
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("refuses a token that unlocks a different package", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizePackage.mockResolvedValue({ ok: true, value: { id: "pkg-other" } });
    const res = await POST(jsonRequest({ package_id: "pkg-1", token: "tok-1" }));
    expect(res.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("maps a worker outage during the token check to 502, not a denial", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizePackage.mockResolvedValue({ ok: false, status: 502 });
    const res = await POST(jsonRequest({ package_id: "pkg-1", token: "tok-1" }));
    expect(res.status).toBe(502);
    errorSpy.mockRestore();
  });
});

describe("POST /api/sessions with viewer ownership (no token)", () => {
  it("rejects an anonymous caller with 401 before any worker call", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(jsonRequest({ package_id: "pkg-1" }));
    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
    expect(listPackagesForUser).not.toHaveBeenCalled();
  });

  it("creates the session when the viewer owns the package", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    listPackagesForUser.mockResolvedValue([{ id: "pkg-1" }, { id: "pkg-2" }]);
    createSession.mockResolvedValue(CREATED);
    const res = await POST(jsonRequest({ package_id: "pkg-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session_id: "sess-1" });
    expect(listPackagesForUser).toHaveBeenCalledWith("viewer-1");
    expect(authorizePackage).not.toHaveBeenCalled();
  });

  it("refuses a package the viewer does not own", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    listPackagesForUser.mockResolvedValue([{ id: "pkg-2" }]);
    const res = await POST(jsonRequest({ package_id: "pkg-1" }));
    expect(res.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("maps a worker outage during the ownership check to 502, not a denial", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    listPackagesForUser.mockRejectedValue(new Error("worker down"));
    const res = await POST(jsonRequest({ package_id: "pkg-1" }));
    expect(res.status).toBe(502);
    expect(createSession).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
