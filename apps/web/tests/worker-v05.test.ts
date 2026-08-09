// Contract tests for the v0.5 worker-client additions: the typed WorkerError
// and the payments/retry/mint client functions. Fetch is stubbed — nothing
// here (or anywhere in tests) may call a live worker or Polar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkerError,
  createQuickPackage,
  incrementSecretMint,
  listOrders,
  listPackagesForUser,
  markPackagePaid,
  retryCompile,
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

describe("WorkerError", () => {
  it("carries status and code and keeps the pinned message shape", async () => {
    nextResponse = jsonResponse(
      { error: "package expired", code: "package-expired" },
      410,
    );
    const err = await listPackagesForUser("user-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    const workerError = err as WorkerError;
    expect(workerError.status).toBe(410);
    expect(workerError.code).toBe("package-expired");
    expect(workerError.detail).toBe("package expired");
    // The message shape predates the typed error; callers and logs pin it.
    expect(workerError.message).toBe(
      "worker GET /api/users/user-1/packages failed: 410",
    );
  });

  it('falls back to code "unknown" when the body has no code key', async () => {
    // Worker endpoints that predate error codes reply {error} or FastAPI
    // {detail} only; the typed error still surfaces status + "unknown".
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    const err = await listPackagesForUser("user-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(500);
    expect((err as WorkerError).code).toBe("unknown");
    expect((err as WorkerError).detail).toBe("boom");
  });

  it("survives a non-JSON error body", async () => {
    nextResponse = new Response("bad gateway", { status: 502 });
    const err = await listPackagesForUser("user-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(502);
    expect((err as WorkerError).code).toBe("unknown");
    expect((err as WorkerError).detail).toBeNull();
  });
});

describe("markPackagePaid", () => {
  const order = {
    user_id: "user-1",
    polar_order_id: "polar-ord-1",
    polar_checkout_id: "polar-chk-1",
    amount_minor: 4900,
    currency: "usd",
    status: "paid",
    paid_at: "2026-08-03T12:00:00Z",
  };

  it("posts the order to the paid endpoint with the id url-encoded", async () => {
    nextResponse = jsonResponse({ package_id: "pkg/1", paid: true });
    await markPackagePaid("pkg/1", order);
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/packages/pkg%2F1/paid",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(order);
  });

  it("throws a WorkerError on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "not found" }, 404);
    const err = await markPackagePaid("pkg-9", order).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(404);
    expect((err as WorkerError).message).toBe(
      "worker POST /api/packages/pkg-9/paid failed: 404",
    );
  });
});

describe("createQuickPackage", () => {
  // Every worker route lives under the /api prefix (app.py mounts the whole
  // router there); a bare "/packages/quick" would 404 against the real
  // worker while every fetch-stubbed test stayed green.
  it("posts company and role to the /api-prefixed quick endpoint", async () => {
    nextResponse = jsonResponse({ package_id: "pkg-1", access_token: "tok-1" });
    await createQuickPackage("user-1", "ExampleCo", "Product Manager");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/packages/quick",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      user_id: "user-1",
      company: "ExampleCo",
      role: "Product Manager",
    });
  });
});

describe("listOrders", () => {
  it("gets the user's orders with the id url-encoded", async () => {
    nextResponse = jsonResponse({ orders: [] });
    await listOrders("user/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/orders?user_id=user%2F1",
    );
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("returns the orders the worker reports", async () => {
    nextResponse = jsonResponse({
      orders: [
        {
          id: "order-1",
          user_id: "user-1",
          package_id: "pkg-1",
          polar_order_id: "polar-ord-1",
          polar_checkout_id: null,
          amount_minor: 4900,
          currency: "usd",
          status: "paid",
          created_at: "2026-08-03T00:00:00+00:00",
        },
      ],
    });
    const orders = await listOrders("user-1");
    expect(orders).toHaveLength(1);
    expect(orders[0].polar_order_id).toBe("polar-ord-1");
    expect(orders[0].amount_minor).toBe(4900);
  });

  it("treats a missing orders key as an empty list", async () => {
    nextResponse = jsonResponse({});
    expect(await listOrders("user-1")).toEqual([]);
  });

  it("throws a WorkerError on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    const err = await listOrders("user-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(500);
  });
});

describe("retryCompile", () => {
  it("posts to the compile-retry endpoint with the id url-encoded", async () => {
    nextResponse = jsonResponse({ package_id: "pkg/1", status: "compiling" }, 202);
    await retryCompile("pkg/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/packages/pkg%2F1/compile-retry",
    );
    expect(calls[0].init?.method).toBe("POST");
  });

  it("throws a WorkerError with the worker's code on a refused retry", async () => {
    nextResponse = jsonResponse(
      { error: "package is not in a failed state", code: "not-retryable" },
      409,
    );
    const err = await retryCompile("pkg-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(409);
    expect((err as WorkerError).code).toBe("not-retryable");
  });
});

describe("incrementSecretMint", () => {
  it("posts to the secret-mint endpoint and returns the new count", async () => {
    nextResponse = jsonResponse({ session_id: "sess/1", secret_mints: 3 });
    const count = await incrementSecretMint("sess/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/sessions/sess%2F1/secret-mint",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(count).toBe(3);
  });

  it("surfaces the over-cap 429 as a WorkerError with the worker's code", async () => {
    nextResponse = jsonResponse(
      { error: "secret mint cap reached for this session", code: "mint-cap" },
      429,
    );
    const err = await incrementSecretMint("sess-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerError);
    expect((err as WorkerError).status).toBe(429);
    expect((err as WorkerError).code).toBe("mint-cap");
  });
});
