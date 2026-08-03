import { beforeEach, describe, expect, it, vi } from "vitest";

// The recordings route no longer accepts the file itself: it authorizes the
// caller and mints a Supabase signed upload URL so the browser uploads the
// blob directly to storage (a real 20-minute recording exceeds Vercel's
// ~4.5 MB function-body limit). These tests pin the route's contract:
// validation before any worker call, token-package match, server-derived
// storage path, upsert-enabled signed URL, and no storage detail echoed to
// the client.

const { authorizePackage, listSessions, createSignedUploadUrl } = vi.hoisted(() => ({
  authorizePackage: vi.fn(),
  listSessions: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));

vi.mock("@/lib/worker", () => ({
  authorizePackage,
  listSessions,
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
  listSessions.mockReset();
  createSignedUploadUrl.mockReset();
  // Default: no session rows yet — the pre-v0.5 shape every existing case
  // assumed. Individual tests override with real statuses.
  listSessions.mockResolvedValue([]);
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

  // v0.5 blob-swap guard: once the session at this index has been submitted
  // for scoring, its recording is scoring evidence. Re-minting an upsert
  // upload URL would let a token holder overwrite the audio AFTER the score
  // exists — the route must refuse, while legitimate retry paths (planned
  // session whose complete call failed; failed/insufficient sessions whose
  // slot is retried) keep working.
  describe("submitted-session guard", () => {
    it.each(["scoring", "scored"] as const)(
      "refuses to mint for a session already %s",
      async (status) => {
        authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
        listSessions.mockResolvedValue([
          { id: "sess-1", index: 1, status },
        ]);
        const res = await POST(jsonRequest({
          packageId: PACKAGE_ID,
          sessionIndex: 1,
          token: "tok-1",
        }));
        expect(res.status).toBe(409);
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("already");
      },
    );

    it.each(["planned", "failed", "insufficient"] as const)(
      "still mints for a %s session (the retry paths)",
      async (status) => {
        authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
        listSessions.mockResolvedValue([
          { id: "sess-1", index: 1, status },
        ]);
        createSignedUploadUrl.mockResolvedValue({
          data: { signedUrl: "https://storage.example.test/upload/sign/x?token=t" },
          error: null,
        });
        const res = await POST(jsonRequest({
          packageId: PACKAGE_ID,
          sessionIndex: 1,
          token: "tok-1",
        }));
        expect(res.status).toBe(200);
      },
    );

    it("only the requested index blocks the mint, not a sibling session", async () => {
      authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
      listSessions.mockResolvedValue([
        { id: "sess-1", index: 1, status: "scored" },
        { id: "sess-2", index: 2, status: "planned" },
      ]);
      createSignedUploadUrl.mockResolvedValue({
        data: { signedUrl: "https://storage.example.test/upload/sign/x?token=t" },
        error: null,
      });
      const res = await POST(jsonRequest({
        packageId: PACKAGE_ID,
        sessionIndex: 2,
        token: "tok-1",
      }));
      expect(res.status).toBe(200);
    });

    it("maps a session-listing outage to 502, never a silent mint", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        authorizePackage.mockResolvedValue({ ok: true, value: { id: PACKAGE_ID } });
        listSessions.mockRejectedValue(new Error("worker down"));
        const res = await POST(jsonRequest({
          packageId: PACKAGE_ID,
          sessionIndex: 1,
          token: "tok-1",
        }));
        expect(res.status).toBe(502);
        expect(createSignedUploadUrl).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
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
