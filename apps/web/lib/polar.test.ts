// Contract tests for the thin Polar client (lib/polar.ts): hosted-checkout
// creation and Standard Webhooks signature verification. Fetch is stubbed —
// nothing in tests may ever call the live Polar API.
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  POLAR_CHECKOUTS_URL,
  PolarApiError,
  PolarConfigError,
  WEBHOOK_TOLERANCE_S,
  createCheckout,
  verifyWebhookSignature,
} from "@/lib/polar";

// --- createCheckout ------------------------------------------------------

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
  nextResponse = jsonResponse({ id: "co_1", url: "https://polar.sh/checkout/co_1" });
  vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_test_token");
  vi.stubEnv("POLAR_PRODUCT_ID", "prod_test_1");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return nextResponse;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const INPUT = {
  packageId: "pkg-1",
  userId: "user-1",
  successUrl: "https://web.test/checkout/success?pkg=pkg-1",
};

describe("createCheckout", () => {
  it("POSTs the product, metadata carrier, and success_url to Polar", async () => {
    const checkout = await createCheckout(INPUT);
    expect(checkout).toEqual({ id: "co_1", url: "https://polar.sh/checkout/co_1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(POLAR_CHECKOUTS_URL);
    expect(calls[0].init?.method).toBe("POST");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer polar_test_token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      products: ["prod_test_1"],
      metadata: { package_id: "pkg-1", user_id: "user-1" },
      success_url: "https://web.test/checkout/success?pkg=pkg-1",
    });
  });

  it("throws PolarConfigError without calling Polar when the token is missing", async () => {
    vi.stubEnv("POLAR_ACCESS_TOKEN", "");
    await expect(createCheckout(INPUT)).rejects.toBeInstanceOf(PolarConfigError);
    expect(calls).toHaveLength(0);
  });

  it("throws PolarConfigError without calling Polar when the product id is missing", async () => {
    vi.stubEnv("POLAR_PRODUCT_ID", "");
    await expect(createCheckout(INPUT)).rejects.toBeInstanceOf(PolarConfigError);
    expect(calls).toHaveLength(0);
  });

  it("throws PolarApiError carrying the status on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ error: "invalid product" }, 422);
    const err = await createCheckout(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolarApiError);
    expect((err as PolarApiError).status).toBe(422);
  });

  it("throws PolarApiError when the 2xx reply carries no hosted url", async () => {
    nextResponse = jsonResponse({ id: "co_1" });
    await expect(createCheckout(INPUT)).rejects.toBeInstanceOf(PolarApiError);
  });
});

// --- verifyWebhookSignature ----------------------------------------------

const SECRET = `whsec_${Buffer.from("test-webhook-key").toString("base64")}`;

function sign(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

const NOW_MS = 1_754_265_600_000; // fixed clock: every case is deterministic
const FRESH_TS = String(NOW_MS / 1000);
const BODY = JSON.stringify({ type: "order.paid", data: { id: "order-1" } });

function verify(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    secret: SECRET,
    webhookId: "msg_1",
    webhookTimestamp: FRESH_TS,
    webhookSignature: sign(SECRET, "msg_1", FRESH_TS, BODY),
    rawBody: BODY,
    nowMs: NOW_MS,
    ...overrides,
  });
}

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed payload", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("accepts when ANY space-separated v1 entry matches", () => {
    const good = sign(SECRET, "msg_1", FRESH_TS, BODY);
    expect(
      verify({ webhookSignature: `v1,${"A".repeat(43)}= ${good}` }),
    ).toEqual({ ok: true });
  });

  const missingHeaderCases: [string, Partial<Parameters<typeof verifyWebhookSignature>[0]>][] = [
    ["webhook-id", { webhookId: null }],
    ["webhook-timestamp", { webhookTimestamp: null }],
    ["webhook-signature", { webhookSignature: null }],
  ];
  it.each(missingHeaderCases)("rejects a payload missing the %s header", (_name, overrides) => {
    expect(verify(overrides)).toEqual({ ok: false, reason: "missing-headers" });
  });

  it("rejects a forged signature", () => {
    expect(
      verify({ webhookSignature: `v1,${Buffer.from("forged".repeat(6)).toString("base64")}` }),
    ).toEqual({ ok: false, reason: "no-match" });
  });

  it("rejects a valid signature over a DIFFERENT body (tampering)", () => {
    expect(verify({ rawBody: BODY.replace("order-1", "order-2") })).toEqual({
      ok: false,
      reason: "no-match",
    });
  });

  it("rejects the wrong scheme even with the right MAC bytes", () => {
    const good = sign(SECRET, "msg_1", FRESH_TS, BODY);
    expect(verify({ webhookSignature: good.replace(/^v1,/, "v2,") })).toEqual({
      ok: false,
      reason: "no-match",
    });
  });

  it("rejects a timestamp older than the tolerance window", () => {
    const stale = String(NOW_MS / 1000 - WEBHOOK_TOLERANCE_S - 60);
    expect(
      verify({
        webhookTimestamp: stale,
        webhookSignature: sign(SECRET, "msg_1", stale, BODY),
      }),
    ).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("rejects a timestamp too far in the future (replay-buffer forgery)", () => {
    const future = String(NOW_MS / 1000 + WEBHOOK_TOLERANCE_S + 60);
    expect(
      verify({
        webhookTimestamp: future,
        webhookSignature: sign(SECRET, "msg_1", future, BODY),
      }),
    ).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verify({ webhookTimestamp: "yesterday" })).toEqual({
      ok: false,
      reason: "bad-timestamp",
    });
  });

  it("rejects a secret without the whsec_ prefix", () => {
    expect(verify({ secret: "plain-secret" })).toEqual({ ok: false, reason: "bad-secret" });
  });

  it("survives a signature entry whose base64 decodes to the wrong length", () => {
    // timingSafeEqual throws on length mismatch; the verifier must treat it
    // as a non-match, not crash the webhook route.
    expect(verify({ webhookSignature: "v1,QQ==" })).toEqual({
      ok: false,
      reason: "no-match",
    });
  });

  it("rejects when the signature list holds no v1 entry at all", () => {
    expect(verify({ webhookSignature: "v2,abc v3,def" })).toEqual({
      ok: false,
      reason: "no-match",
    });
  });
});
