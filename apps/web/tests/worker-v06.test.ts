// Contract tests for the v0.6 worker-client additions. Each function is the
// web half of an endpoint Phase 0 wired and a track implements, so these
// tests pin the wire contract the track must satisfy: method, path, encoding,
// and failure surfacing through the existing typed WorkerError.
//
// Fetch is stubbed — nothing here (or anywhere in tests) calls a live worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkerError, deleteAccount, usageMetrics } from "@/lib/worker";

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

describe("deleteAccount", () => {
  it("deletes with the user id as an encoded query parameter", async () => {
    // A query parameter, not a body: DELETE bodies are handled unevenly by
    // proxies and clients. The bearer token is what authorizes the call.
    await deleteAccount("user/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/account?user_id=user%2F1",
    );
    expect(calls[0].init?.method).toBe("DELETE");
  });

  it("throws a typed WorkerError with the worker's code on a refusal", async () => {
    nextResponse = jsonResponse(
      { error: "account deletion is not available yet", code: "not-implemented" },
      501,
    );
    const err = await deleteAccount("user-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(501);
    expect((err as WorkerError).code).toBe("not-implemented");
    expect((err as WorkerError).detail).toBe("account deletion is not available yet");
    expect((err as WorkerError).message).toBe("worker DELETE /api/account failed: 501");
  });
});

describe("usageMetrics", () => {
  it("gets the operator's usage endpoint", async () => {
    nextResponse = jsonResponse({
      sample_size: 12,
      session_completion_rate: 0.75,
      p50_first_response_s: 1.4,
      p50_scoring_latency_s: 96.2,
      package_burn_through: 0.5,
    });
    const metrics = await usageMetrics();
    expect(calls[0].url).toBe("https://worker.example.test/api/metrics/usage");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(metrics.sample_size).toBe(12);
    expect(metrics.session_completion_rate).toBe(0.75);
  });

  it("throws a typed WorkerError on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ error: "not available", code: "not-implemented" }, 501);
    const err = await usageMetrics().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(501);
    expect((err as WorkerError).code).toBe("not-implemented");
  });
});
