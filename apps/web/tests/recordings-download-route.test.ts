import { beforeEach, describe, expect, it, vi } from "vitest";

// Contract tests for POST /api/recordings/download, the mirror of the upload
// mint: authorize the caller, then mint a signed DOWNLOAD URL (TTL 3600s) for
// the server-derived storage path. Same validation order as the upload route,
// with one addition — the token is legacy, so a signed-in viewer who OWNS the
// package passes without one. These tests pin: validation before any worker
// or auth call, token-package match, viewer-ownership fallback, server-derived
// path + TTL, and no storage detail echoed to the client.

const { authorizePackage, listPackagesForUser, getViewer, createSignedUrl } =
  vi.hoisted(() => ({
    authorizePackage: vi.fn(),
    listPackagesForUser: vi.fn(),
    getViewer: vi.fn(),
    createSignedUrl: vi.fn(),
  }));

vi.mock("@/lib/worker", () => ({
  authorizePackage,
  listPackagesForUser,
}));

vi.mock("@/lib/viewer", () => ({
  getViewer,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ createSignedUrl }),
    },
  }),
}));

import { POST } from "@/app/api/recordings/download/route";

const PACKAGE_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";
const STORAGE_PATH = `packages/${PACKAGE_ID}/session-1.webm`;

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/recordings/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authorizePackage.mockReset();
  listPackagesForUser.mockReset();
  getViewer.mockReset();
  createSignedUrl.mockReset();
});

describe("POST /api/recordings/download (signed download URL mint)", () => {
  it("rejects a non-UUID packageId before any worker or auth call", async () => {
    const res = await POST(jsonRequest({
      packageId: "../../etc/passwd",
      sessionIndex: 1,
      token: "tok-1",
    }));
    expect(res.status).toBe(400);
    expect(authorizePackage).not.toHaveBeenCalled();
    expect(getViewer).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range sessionIndex before any worker or auth call", async () => {
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 100,
      token: "tok-1",
    }));
    expect(res.status).toBe(400);
    expect(authorizePackage).not.toHaveBeenCalled();
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("denies when the token unlocks a different package", async () => {
    authorizePackage.mockResolvedValue({
      ok: true,
      value: { id: "00000000-0000-4000-8000-000000000000" },
    });
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
      token: "tok-1",
    }));
    expect(res.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("mints a one-hour signed URL for the server-derived path (token path)", async () => {
    authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/sign/recordings/x?token=t" },
      error: null,
    });
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
      token: "tok-1",
    }));
    expect(res.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith(STORAGE_PATH, 3600);
    expect(await res.json()).toEqual({
      signedUrl: "https://storage.example.test/sign/recordings/x?token=t",
    });
    // The token satisfied the check; the viewer stack stays untouched.
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("mints for a signed-in viewer who owns the package, without a token", async () => {
    getViewer.mockResolvedValue({ id: "user-1", email: "a@b.test" });
    listPackagesForUser.mockResolvedValue([{ id: PACKAGE_ID }]);
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/sign/recordings/y?token=t" },
      error: null,
    });
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
    }));
    expect(res.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith(STORAGE_PATH, 3600);
    expect(authorizePackage).not.toHaveBeenCalled();
  });

  it("returns 401 when there is neither a token nor a signed-in viewer", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
    }));
    expect(res.status).toBe(401);
    expect(listPackagesForUser).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("denies a signed-in viewer who does not own the package", async () => {
    getViewer.mockResolvedValue({ id: "user-1", email: "a@b.test" });
    listPackagesForUser.mockResolvedValue([
      { id: "00000000-0000-4000-8000-000000000000" },
    ]);
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
    }));
    expect(res.status).toBe(403);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("maps a worker outage to 502 on the viewer path, never a denial", async () => {
    getViewer.mockResolvedValue({ id: "user-1", email: "a@b.test" });
    listPackagesForUser.mockRejectedValue(new Error("worker down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(jsonRequest({
        packageId: PACKAGE_ID,
        sessionIndex: 1,
      }));
      expect(res.status).toBe(502);
    } finally {
      errorSpy.mockRestore();
    }
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("maps a worker outage to 502 on the token path", async () => {
    authorizePackage.mockResolvedValue({ ok: false, status: 502 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(jsonRequest({
        packageId: PACKAGE_ID,
        sessionIndex: 1,
        token: "tok-1",
      }));
      expect(res.status).toBe(502);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects a malformed token type without falling back to the viewer", async () => {
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
      token: 42,
    }));
    expect(res.status).toBe(400);
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("returns a generic 502 without echoing the storage error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
      createSignedUrl.mockResolvedValue({
        data: null,
        error: { message: "bucket exploded: internal detail" },
      });
      const res = await POST(jsonRequest({
        packageId: PACKAGE_ID,
        sessionIndex: 1,
        token: "tok-1",
      }));
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toContain("bucket exploded");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
