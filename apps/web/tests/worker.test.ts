import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeSession,
  createPackage,
  createSession,
  getPackageByToken,
  getSession,
  workerFetch,
} from "@/lib/worker";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const calls: RecordedCall[] = [];
let nextResponse: Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sentHeaders(): Headers {
  return new Headers(calls[0].init?.headers);
}

beforeEach(() => {
  calls.length = 0;
  nextResponse = jsonResponse({});
  vi.stubEnv("WORKER_URL", "https://worker.example.test");
  vi.stubEnv("WORKER_API_TOKEN", "test-worker-token");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return nextResponse;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("workerFetch", () => {
  it("joins WORKER_URL and the path", async () => {
    await workerFetch("/healthz");
    expect(calls[0].url).toBe("https://worker.example.test/healthz");
  });

  it("sends the bearer token from WORKER_API_TOKEN", async () => {
    await workerFetch("/healthz");
    expect(sentHeaders().get("authorization")).toBe("Bearer test-worker-token");
  });

  it("sets a json content-type when a body is present", async () => {
    await workerFetch("/api/packages", { method: "POST", body: JSON.stringify({ jd_text: "x" }) });
    expect(sentHeaders().get("content-type")).toBe("application/json");
  });

  it("throws before fetching when WORKER_URL is missing", async () => {
    vi.stubEnv("WORKER_URL", "");
    await expect(workerFetch("/healthz")).rejects.toThrow("WORKER_URL");
    expect(calls).toHaveLength(0);
  });

  it("throws before fetching when WORKER_API_TOKEN is missing", async () => {
    vi.stubEnv("WORKER_API_TOKEN", "");
    await expect(workerFetch("/healthz")).rejects.toThrow("WORKER_API_TOKEN");
    expect(calls).toHaveLength(0);
  });
});

describe("createPackage", () => {
  it("posts the intake body and returns package_id and access_token", async () => {
    nextResponse = jsonResponse({ package_id: "pkg-1", access_token: "tok-1" }, 202);
    const created = await createPackage({ jd_text: "We hire analysts." });
    expect(calls[0].url).toBe("https://worker.example.test/api/packages");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ jd_text: "We hire analysts." });
    expect(created).toEqual({ package_id: "pkg-1", access_token: "tok-1" });
  });

  it("throws with the status code on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    await expect(createPackage({ jd_text: "x" })).rejects.toThrow(
      "worker POST /api/packages failed: 500",
    );
  });
});

describe("getPackageByToken", () => {
  it("gets the by-token path with the token url-encoded", async () => {
    nextResponse = jsonResponse({ id: "pkg-1", access_token: "tok/1", status: "compiling" });
    await getPackageByToken("tok/1");
    expect(calls[0].url).toBe("https://worker.example.test/api/packages/by-token/tok%2F1");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });
});

describe("createSession", () => {
  it("posts package_id and returns the session payload", async () => {
    nextResponse = jsonResponse({
      session_id: "sess-1",
      session_plan: null,
      interviewer_instructions: "You are Morgan.",
    });
    const created = await createSession("pkg-1");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ package_id: "pkg-1" });
    expect(created.session_id).toBe("sess-1");
  });
});

describe("completeSession", () => {
  it("posts audio_path to the complete endpoint", async () => {
    nextResponse = jsonResponse({ ok: true }, 202);
    await completeSession("sess-1", "packages/pkg-1/session-1.webm");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions/sess-1/complete");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      audio_path: "packages/pkg-1/session-1.webm",
    });
  });

  it("throws with the status code on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "not found" }, 404);
    await expect(completeSession("sess-9", "x.webm")).rejects.toThrow(
      "worker POST /api/sessions/sess-9/complete failed: 404",
    );
  });
});

describe("getSession", () => {
  it("gets the session row by id", async () => {
    nextResponse = jsonResponse({ id: "sess-1", package_id: "pkg-1", status: "scoring" });
    const row = await getSession("sess-1");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions/sess-1");
    expect(row.status).toBe("scoring");
  });
});
