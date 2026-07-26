import { beforeEach, describe, expect, it, vi } from "vitest";

// The recordings route no longer accepts the file itself: it authorizes the
// caller and mints a Supabase signed upload URL so the browser uploads the
// blob directly to storage (a real 20-minute recording exceeds Vercel's
// ~4.5 MB function-body limit). These tests pin the route's contract:
// validation before any worker call, token-package match, server-derived
// storage path, upsert-enabled signed URL, and no storage detail echoed to
// the client.

const { authorizePackage, createSignedUploadUrl } = vi.hoisted(() => ({
  authorizePackage: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@/lib/worker", () => ({
  authorizePackage,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: () => ({ createSignedUploadUrl }),
    },
  }),
}));

import { POST } from "@/app/api/recordings/route";

const PACKAGE_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/recordings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authorizePackage.mockReset();
  createSignedUploadUrl.mockReset();
});

describe("POST /api/recordings (signed upload URL mint)", () => {
  it("rejects a non-UUID packageId before calling the worker", async () => {
    const res = await POST(jsonRequest({
      packageId: "../../etc/passwd",
      sessionIndex: 1,
      token: "tok-1",
    }));
    expect(res.status).toBe(400);
    expect(authorizePackage).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range sessionIndex before calling the worker", async () => {
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 100,
      token: "tok-1",
    }));
    expect(res.status).toBe(400);
    expect(authorizePackage).not.toHaveBeenCalled();
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
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("mints an upsert-enabled signed URL for the server-derived path", async () => {
    authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
    createSignedUploadUrl.mockResolvedValue({
      data: {
        signedUrl: "https://storage.example.test/upload/sign/recordings/x?token=t",
        token: "t",
        path: `packages/${PACKAGE_ID}/session-1.webm`,
      },
      error: null,
    });
    const res = await POST(jsonRequest({
      packageId: PACKAGE_ID,
      sessionIndex: 1,
      token: "tok-1",
    }));
    expect(res.status).toBe(200);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      `packages/${PACKAGE_ID}/session-1.webm`,
      { upsert: true },
    );
    expect(await res.json()).toEqual({
      signedUrl: "https://storage.example.test/upload/sign/recordings/x?token=t",
    });
  });

  it("returns a generic 502 without echoing the storage error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
      createSignedUploadUrl.mockResolvedValue({
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
