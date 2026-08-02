import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /switch is the only writer of the active-package cookie, so these tests
// pin what keeps it safe: the cookie is set only for a package the signed-in
// viewer actually owns, and the redirect target only ever comes out of
// safeNextPath.

const { getViewer, listPackagesForUser } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  listPackagesForUser: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer }));

vi.mock("@/lib/worker", () => ({ listPackagesForUser }));

import { GET } from "@/app/switch/route";

function request(query: string): Request {
  return new Request(`http://web.test/switch${query}`, { method: "GET" });
}

function ownedPackage(id: string) {
  return {
    id,
    access_token: `tok-${id}`,
    status: "ready",
    user_id: "viewer-1",
    total_sessions: 6,
    sessions_used: 1,
    role_title: "Deployment Strategist",
  };
}

const viewer = { id: "viewer-1", email: "tae@example.com" };

beforeEach(() => {
  getViewer.mockReset();
  listPackagesForUser.mockReset();
});

describe("GET /switch", () => {
  it("sends a signed-out visitor to login and back through /switch", async () => {
    getViewer.mockResolvedValue(null);
    const res = await GET(request("?pkg=pkg-1&next=/progress"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/switch?pkg=pkg-1&next=/progress",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(listPackagesForUser).not.toHaveBeenCalled();
  });

  it("sets the cookie for an owned package and redirects to next", async () => {
    getViewer.mockResolvedValue(viewer);
    listPackagesForUser.mockResolvedValue([
      ownedPackage("pkg-1"),
      ownedPackage("pkg-2"),
    ]);
    const res = await GET(request("?pkg=pkg-2&next=/progress"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/progress");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("fc_pkg=pkg-2");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain("Path=/");
    expect(listPackagesForUser).toHaveBeenCalledWith("viewer-1");
  });

  it("never sets the cookie for a package the viewer does not own", async () => {
    getViewer.mockResolvedValue(viewer);
    listPackagesForUser.mockResolvedValue([ownedPackage("pkg-1")]);
    const res = await GET(request("?pkg=pkg-foreign&next=/home"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/home");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("redirects without touching the worker when pkg is missing", async () => {
    getViewer.mockResolvedValue(viewer);
    const res = await GET(request("?next=/home"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/home");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(listPackagesForUser).not.toHaveBeenCalled();
  });

  it("still redirects when the worker is unreachable, without a cookie", async () => {
    getViewer.mockResolvedValue(viewer);
    listPackagesForUser.mockRejectedValue(new Error("worker down"));
    const res = await GET(request("?pkg=pkg-1&next=/home"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/home");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses to redirect anywhere but a same-origin path", async () => {
    getViewer.mockResolvedValue(viewer);
    listPackagesForUser.mockResolvedValue([ownedPackage("pkg-1")]);
    for (const hostile of [
      "?pkg=pkg-1&next=https://evil.test/phish",
      "?pkg=pkg-1&next=//evil.test/phish",
      "?pkg=pkg-1",
    ]) {
      const res = await GET(request(hostile));
      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.origin).toBe("http://web.test");
      expect(location.pathname).toBe("/home");
    }
  });
});
