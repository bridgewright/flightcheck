import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

// F-12: the interview room must carry no capability token.
//
// It used to. The room page read the package's access_token and passed it to
// SessionRoom as a prop, which serialized a permanent, package-wide
// credential into the RSC payload of the page — and the component then
// echoed it into three request bodies. Whoever held that string could start
// and complete sessions on the package, forever, with no expiry and no way
// to revoke it.
//
// Two halves are tested here: the source no longer contains the credential
// (the screens have no render harness — environment: node, no jsdom — so
// this scans them, the same technique as tests/token-in-href.test.ts), and
// the upload route that forced the token to exist now authorizes the viewer.

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("the room ships no capability token", () => {
  it("the room page reads no access_token at all", () => {
    expect(source("app/sessions/[id]/room/page.tsx")).not.toContain(
      "access_token",
    );
  });

  it("SessionRoom takes no token prop", () => {
    const room = source("components/SessionRoom.tsx");
    expect(room).not.toMatch(/^\s*token\??:\s*string/m);
    expect(room).not.toMatch(/JSON\.stringify\(\{[^}]*\btoken\b/);
  });

  it("SessionRoom sends only the session id to the privileged routes", () => {
    const room = source("components/SessionRoom.tsx");
    expect(room).toContain('body: JSON.stringify({ sessionId })');
    expect(room).toContain('body: JSON.stringify({ action: "complete" })');
  });

  it("the room page gates entry on the session capability window", () => {
    const page = source("app/sessions/[id]/room/page.tsx");
    expect(page).toContain("sessionCapability");
  });
});

// --- the upload route's viewer credential --------------------------------

const { getViewer, authorizeViewerSession, listSessions, createSignedUploadUrl } =
  vi.hoisted(() => ({
    getViewer: vi.fn(),
    authorizeViewerSession: vi.fn(),
    listSessions: vi.fn(),
    createSignedUploadUrl: vi.fn(),
  }));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  authorizePackage: vi.fn(),
  authorizeViewerSession,
  listSessions,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } }),
}));

const { POST } = await import("@/app/api/recordings/route");
const { recordingStoragePath } = await import("@/lib/realtime");

const PACKAGE_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/recordings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authorizedSession(index = 2, status = "planned") {
  return {
    ok: true,
    value: {
      session: { id: "sess-1", package_id: PACKAGE_ID, index, status },
      pkg: { id: PACKAGE_ID },
    },
  };
}

beforeEach(() => {
  getViewer.mockReset();
  authorizeViewerSession.mockReset();
  listSessions.mockReset();
  createSignedUploadUrl.mockReset();
  getViewer.mockResolvedValue({ id: "user-1" });
  listSessions.mockResolvedValue([]);
  createSignedUploadUrl.mockResolvedValue({
    data: { signedUrl: "https://storage.test/signed" },
    error: null,
  });
});

describe("POST /api/recordings with no token", () => {
  it("mints an upload URL for the signed-in owner of the session", async () => {
    authorizeViewerSession.mockResolvedValue(authorizedSession());
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedUrl: "https://storage.test/signed" });
    expect(authorizeViewerSession).toHaveBeenCalledWith({ id: "user-1" }, "sess-1");
  });

  it("derives the storage path from the authorized row, not the request", async () => {
    // The body carried no package id and no index at all, so a caller
    // cannot aim the upload URL at another package's recording.
    authorizeViewerSession.mockResolvedValue(authorizedSession(4));
    await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(createSignedUploadUrl).toHaveBeenCalledWith(
      recordingStoragePath(PACKAGE_ID, 4),
      { upsert: true },
    );
  });

  it("refuses an anonymous caller before any worker call", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(401);
    expect(authorizeViewerSession).not.toHaveBeenCalled();
  });

  it("requires a sessionId before touching auth", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(getViewer).not.toHaveBeenCalled();
  });

  it("answers 403 for a session the viewer does not own", async () => {
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 403 });
    const res = await POST(jsonRequest({ sessionId: "sess-x" }));
    expect(res.status).toBe(403);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("keeps a worker outage distinct from a denial", async () => {
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 502 });
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(502);
  });

  it("still refuses to re-mint over a scored session", async () => {
    // The v0.5 blob-swap guard must apply to this credential too, or the
    // new path would be a way around it.
    authorizeViewerSession.mockResolvedValue(authorizedSession(2));
    listSessions.mockResolvedValue([{ index: 2, status: "scored" }]);
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(409);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("never gates the upload on the capability window", async () => {
    // The interview already happened. An expiry that lapsed mid-session
    // must not be the reason the recording is thrown away.
    authorizeViewerSession.mockResolvedValue({
      ok: true,
      value: {
        session: {
          id: "sess-1",
          package_id: PACKAGE_ID,
          index: 2,
          status: "planned",
          access_token_expires_at: "2000-01-01T00:00:00Z",
          token_revoked_at: "2000-01-01T00:00:00Z",
        },
        pkg: { id: PACKAGE_ID },
      },
    });
    const res = await POST(jsonRequest({ sessionId: "sess-1" }));
    expect(res.status).toBe(200);
  });
});
