import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Tripwire (mirrors sessions-route.test.ts): GET /api/packages/[token] once
// proxied the raw worker PackageRow to the browser — including
// rubric.question_bank (every interview question plus its follow-up probes),
// the BARS anchors, jd_text, and an echo of the access token. That is the
// answer key of the interview: any token holder could read the questions
// before taking the session, defeating the containment the sessions route
// states explicitly. The route was dead code (the package page reads the
// worker server-side; PollRefresh uses router.refresh()) and was deleted.
//
// If a client-side package poll is ever needed, add a route that returns a
// projected shape ONLY: {id, status, rubric: {role_title, company,
// dimensions: [{key, name, weight, channel, signals}]}} — never
// question_bank, research_summary, anchors, jd_text, or access_token.
describe("no browser-reachable package proxy route", () => {
  it("app/api/packages/[token] stays deleted", () => {
    const routeDir = fileURLToPath(
      new URL("../app/api/packages/[token]", import.meta.url),
    );
    expect(existsSync(routeDir)).toBe(false);
  });
});

// POST /api/packages is auth-gated: interviews require sign-in (PRD), so
// packages are born bound to the creating account and never pass through an
// unclaimed phase. These tests pin the two security properties: an anonymous
// caller is refused before any worker call, and the owner is the SESSION's
// user — a user_id in the request body is discarded, because a caller who
// could name the owner could mint packages into any account.

const { getViewer, createPackage } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  createPackage: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer }));

vi.mock("@/lib/worker", () => ({
  createPackage,
  WorkerRejectionError: class WorkerRejectionError extends Error {},
}));

import { WorkerRejectionError } from "@/lib/worker";

import { POST } from "@/app/api/packages/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://web.test/api/packages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getViewer.mockReset();
  createPackage.mockReset();
});

describe("POST /api/packages", () => {
  it("rejects an anonymous caller with 401 before any worker call", async () => {
    getViewer.mockResolvedValue(null);
    const res = await POST(jsonRequest({ jd_text: "We hire analysts." }));
    expect(res.status).toBe(401);
    expect(createPackage).not.toHaveBeenCalled();
  });

  it("rejects a body without jd_text or jd_url", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(createPackage).not.toHaveBeenCalled();
  });

  it("creates the package born bound to the session's user", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: "tae@example.com" });
    createPackage.mockResolvedValue({ package_id: "pkg-1", access_token: "tok-1" });
    const res = await POST(jsonRequest({ jd_text: "We hire analysts." }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ package_id: "pkg-1", access_token: "tok-1" });
    expect(createPackage).toHaveBeenCalledWith({
      jd_text: "We hire analysts.",
      user_id: "viewer-1",
    });
  });

  it("discards a user_id sent in the request body", async () => {
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    createPackage.mockResolvedValue({ package_id: "pkg-1", access_token: "tok-1" });
    await POST(jsonRequest({ jd_text: "x", user_id: "someone-else" }));
    expect(createPackage).toHaveBeenCalledWith({ jd_text: "x", user_id: "viewer-1" });
  });

  it("surfaces the worker's 422 rejection message to the form", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      getViewer.mockResolvedValue({ id: "viewer-1", email: null });
      createPackage.mockRejectedValue(
        new WorkerRejectionError("could not fetch that URL; paste the JD text instead"),
      );
      const res = await POST(jsonRequest({ jd_url: "https://jd.example.test/x" }));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: "could not fetch that URL; paste the JD text instead",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("maps other worker failures to a generic 502", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      getViewer.mockResolvedValue({ id: "viewer-1", email: null });
      createPackage.mockRejectedValue(new Error("worker POST /api/packages failed: 500"));
      const res = await POST(jsonRequest({ jd_text: "x" }));
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toContain("500");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
