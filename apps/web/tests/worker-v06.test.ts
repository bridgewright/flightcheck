// Contract tests for the v0.6 worker-client additions. Each function is the
// web half of an endpoint Phase 0 wired and a track implements, so these
// tests pin the wire contract the track must satisfy: method, path, encoding,
// and failure surfacing through the existing typed WorkerError.
//
// Fetch is stubbed — nothing here (or anywhere in tests) calls a live worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkerError, deleteAccount, previewRubric, usageMetrics } from "@/lib/worker";
import type { RubricPreview } from "@/lib/types";

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

describe("previewRubric", () => {
  const preview: RubricPreview = {
    role_title: "Senior Product Analyst",
    company: "ExampleCorp",
    dimensions: [
      { key: "metric-definition", name: "Metric definition", weight: 0.4, channel: "content" },
      { key: "clarity", name: "Clarity under pressure", weight: 0.6, channel: "delivery" },
    ],
  };

  it("posts the JD text and returns the compiled preview", async () => {
    nextResponse = jsonResponse(preview);
    const result = await previewRubric("We are hiring an analyst.");
    expect(calls[0].url).toBe("https://worker.example.test/api/preview/rubric");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      jd_text: "We are hiring an analyst.",
    });
    expect(result).toEqual(preview);
  });

  it("forwards an abort signal so the landing widget can cancel", async () => {
    // The widget fires on a paste and the visitor keeps typing; an
    // abandoned preview must stop costing a model call, not race the next.
    const controller = new AbortController();
    nextResponse = jsonResponse(preview);
    await previewRubric("We are hiring an analyst.", controller.signal);
    expect(calls[0].init?.signal).toBe(controller.signal);
  });

  it("surfaces the busy state as a WorkerError carrying the worker's code", async () => {
    // The honest degraded state above the daily ceiling is part of the
    // feature: the landing page reads status + code, never the message.
    nextResponse = jsonResponse(
      { error: "preview is busy — sign in to compile yours for real", code: "preview-busy" },
      429,
    );
    const err = await previewRubric("We are hiring.").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(429);
    expect((err as WorkerError).code).toBe("preview-busy");
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
