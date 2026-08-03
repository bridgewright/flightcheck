// The two request-id paths that only exist inside a Next request scope, so
// next/headers is mocked here. The unmocked fallback path lives in
// tests/worker-request-id.test.ts, where headers() really does throw.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REQUEST_ID_HEADER } from "@/lib/request-id";
import { workerFetch } from "@/lib/worker";

const inbound = vi.hoisted(() => ({
  read: async (): Promise<Headers> => new Headers(),
}));

vi.mock("next/headers", () => ({
  headers: () => inbound.read(),
}));

const calls: { init: RequestInit | undefined }[] = [];

beforeEach(() => {
  calls.length = 0;
  inbound.read = async () => new Headers();
  vi.stubEnv("WORKER_URL", "https://worker.example.test");
  vi.stubEnv("WORKER_API_TOKEN", "test-worker-token");
  vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ init });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function sentRequestId(): string | null {
  return new Headers(calls[0].init?.headers).get(REQUEST_ID_HEADER);
}

describe("request id inside a request scope", () => {
  it("forwards the id the inbound request already carried", async () => {
    inbound.read = async () => new Headers({ [REQUEST_ID_HEADER]: "vercel-req-7" });
    await workerFetch("/healthz");
    expect(sentRequestId()).toBe("vercel-req-7");
  });

  it("mints its own when the inbound id is unusable", async () => {
    inbound.read = async () => new Headers({ [REQUEST_ID_HEADER]: "not a safe id" });
    await workerFetch("/healthz");
    expect(sentRequestId()).not.toBe("not a safe id");
    expect(sentRequestId()).not.toBeNull();
  });

  it("re-throws Next's control-flow errors instead of swallowing them", async () => {
    // A route that reads headers during static rendering gets a throw with a
    // digest, which is how Next bails out to dynamic rendering. Catching it
    // here would leave the page prerendered with one request's data.
    inbound.read = async () => {
      const bailout = new Error("Dynamic server usage: headers");
      (bailout as Error & { digest: string }).digest = "DYNAMIC_SERVER_USAGE";
      throw bailout;
    };
    await expect(workerFetch("/healthz")).rejects.toThrow("Dynamic server usage");
    expect(calls).toHaveLength(0);
  });
});
