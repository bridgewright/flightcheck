// Contract test for the shared half of F-36: every worker call carries an
// x-request-id. Fetch is stubbed; nothing here reaches a live worker.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { getSession, listOrders, workerFetch } from "@/lib/worker";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const calls: RecordedCall[] = [];

function sentRequestId(index = 0): string | null {
  return new Headers(calls[index].init?.headers).get(REQUEST_ID_HEADER);
}

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("WORKER_URL", "https://worker.example.test");
  vi.stubEnv("WORKER_API_TOKEN", "test-worker-token");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("workerFetch request id", () => {
  it("sends an id the worker's normalizer will accept", async () => {
    await workerFetch("/healthz");
    const sent = sentRequestId();
    expect(sent).not.toBeNull();
    expect(normalizeRequestId(sent)).toBe(sent);
  });

  it("keeps the bearer token alongside it", async () => {
    await workerFetch("/healthz");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-worker-token");
    expect(headers.get(REQUEST_ID_HEADER)).not.toBeNull();
  });

  it("lets an explicit id on the call win", async () => {
    // A caller that already knows the id of the work it is continuing --
    // a retry, a fan-out from a job -- must be able to keep it.
    await workerFetch("/healthz", { headers: { [REQUEST_ID_HEADER]: "explicit-1" } });
    expect(sentRequestId()).toBe("explicit-1");
  });

  it("puts an id on the typed client functions too", async () => {
    // Not just workerFetch: the whole client surface goes through it, so a
    // spot check of two shapes (path param, query param) covers the rest.
    await getSession("sess-1");
    await listOrders("user-1");
    expect(normalizeRequestId(sentRequestId(0))).toBe(sentRequestId(0));
    expect(normalizeRequestId(sentRequestId(1))).toBe(sentRequestId(1));
  });

  it("falls back to a fresh id outside a Next request scope", async () => {
    // These tests run with no inbound request, which is exactly the state a
    // script or a test harness is in: the call must still be traceable, so
    // an id is minted rather than omitted.
    await workerFetch("/healthz");
    await workerFetch("/healthz");
    expect(sentRequestId(0)).not.toBeNull();
    expect(sentRequestId(1)).not.toBeNull();
  });
});
