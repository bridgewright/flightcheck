// Contract tests for POST /api/webhooks/polar — the only door through which
// money becomes sessions. The properties pinned here, in order of what they
// are worth: a forged or unsigned payload provisions NOTHING (clone of the
// packages-route privilege-escalation stance); the signature tampering table
// (style of signout-route.test.ts); replay idempotency rides polar_order_id;
// and both order→account carriers work — metadata primary, customer-email
// fallback (metadata propagation onto the order was UNVERIFIED in recon).
// The worker client is mocked and fetch is stubbed: no live Polar, no live
// Supabase, ever.
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { markPackagePaid, listPackagesForUser } = vi.hoisted(() => ({
  markPackagePaid: vi.fn(),
  listPackagesForUser: vi.fn(),
}));

vi.mock("@/lib/worker", () => ({ markPackagePaid, listPackagesForUser }));

import { POST } from "@/app/api/webhooks/polar/route";

const SECRET = `whsec_${Buffer.from("test-webhook-key").toString("base64")}`;

function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const mac = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

function freshTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

interface OrderData {
  [key: string]: unknown;
}

function orderPaidBody(dataOverrides: OrderData = {}): string {
  return JSON.stringify({
    type: "order.paid",
    data: {
      id: "polar-order-1",
      checkout_id: "co_1",
      total_amount: 4900,
      currency: "usd",
      paid_at: "2026-08-03T12:00:00Z",
      customer: { email: "tae@example.com" },
      metadata: { package_id: "pkg-1", user_id: "user-1" },
      ...dataOverrides,
    },
  });
}

function signedRequest(
  body: string,
  overrides: { id?: string | null; timestamp?: string | null; signature?: string | null } = {},
): Request {
  const id = overrides.id === undefined ? "msg_1" : overrides.id;
  const timestamp = overrides.timestamp === undefined ? freshTimestamp() : overrides.timestamp;
  const signature =
    overrides.signature === undefined ? sign(id ?? "", timestamp ?? "", body) : overrides.signature;
  const headers = new Headers({ "content-type": "application/json" });
  if (id !== null) headers.set("webhook-id", id);
  if (timestamp !== null) headers.set("webhook-timestamp", timestamp);
  if (signature !== null) headers.set("webhook-signature", signature);
  return new Request("http://web.test/api/webhooks/polar", { method: "POST", headers, body });
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const fetchCalls: RecordedCall[] = [];
let adminUsersResponse: Response;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  markPackagePaid.mockReset();
  markPackagePaid.mockResolvedValue(undefined);
  listPackagesForUser.mockReset();
  listPackagesForUser.mockResolvedValue([]);
  fetchCalls.length = 0;
  adminUsersResponse = new Response(JSON.stringify({ users: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  vi.stubEnv("POLAR_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return adminUsersResponse;
  });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

describe("POST /api/webhooks/polar — fail closed", () => {
  it("returns 503 and provisions nothing when POLAR_WEBHOOK_SECRET is missing", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
    // Even a payload that WOULD verify against the test secret must not be
    // processed: no secret means no verification, means no provisioning.
    const res = await POST(signedRequest(orderPaidBody()));
    expect(res.status).toBe(503);
    expect(markPackagePaid).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });
});

describe("POST /api/webhooks/polar — signature tampering", () => {
  const body = orderPaidBody();
  const tamperCases: [string, () => Request][] = [
    ["an unsigned payload", () => signedRequest(body, { signature: null })],
    [
      "a forged signature",
      () =>
        signedRequest(body, {
          signature: `v1,${Buffer.from("forged-mac-bytes-here-32-bytes!!").toString("base64")}`,
        }),
    ],
    [
      "a valid signature over a different body",
      () => {
        const timestamp = freshTimestamp();
        return signedRequest(body.replace("pkg-1", "pkg-2"), {
          timestamp,
          signature: sign("msg_1", timestamp, body),
        });
      },
    ],
    [
      "a stale timestamp",
      () => {
        const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
        return signedRequest(body, { timestamp: stale });
      },
    ],
    ["a missing webhook-id header", () => signedRequest(body, { id: null })],
    ["a missing webhook-timestamp header", () => signedRequest(body, { timestamp: null })],
    [
      "a wrong signature scheme (v2 only)",
      () => {
        const timestamp = freshTimestamp();
        return signedRequest(body, {
          timestamp,
          signature: sign("msg_1", timestamp, body).replace(/^v1,/, "v2,"),
        });
      },
    ],
  ];

  it.each(tamperCases)("rejects %s with 403 and provisions NOTHING", async (_name, make) => {
    const res = await POST(make());
    expect(res.status).toBe(403);
    expect(markPackagePaid).not.toHaveBeenCalled();
    expect(listPackagesForUser).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it("accepts when any space-separated v1 entry matches", async () => {
    const timestamp = freshTimestamp();
    const res = await POST(
      signedRequest(body, {
        timestamp,
        signature: `v1,${"A".repeat(43)}= ${sign("msg_1", timestamp, body)}`,
      }),
    );
    expect(res.status).toBe(200);
    expect(markPackagePaid).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/webhooks/polar — order.paid provisioning", () => {
  it("provisions through the metadata carrier without any account lookup", async () => {
    const res = await POST(signedRequest(orderPaidBody()));
    expect(res.status).toBe(200);
    expect(markPackagePaid).toHaveBeenCalledExactlyOnceWith("pkg-1", {
      user_id: "user-1",
      polar_order_id: "polar-order-1",
      polar_checkout_id: "co_1",
      amount_minor: 4900,
      currency: "usd",
      status: "paid",
      paid_at: "2026-08-03T12:00:00Z",
    });
    // Metadata was sufficient: the email fallback must not fire.
    expect(fetchCalls).toEqual([]);
    expect(listPackagesForUser).not.toHaveBeenCalled();
  });

  it("forwards the same polar_order_id on a replay (idempotency key)", async () => {
    // The worker dedupes on polar_order_id; the route's job is to forward the
    // SAME key both times and treat the replay as success, provisioning
    // nothing new itself.
    const first = await POST(signedRequest(orderPaidBody()));
    const second = await POST(signedRequest(orderPaidBody()));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(markPackagePaid).toHaveBeenCalledTimes(2);
    const orderIds = markPackagePaid.mock.calls.map(
      (call) => (call[1] as { polar_order_id: string }).polar_order_id,
    );
    expect(orderIds).toEqual(["polar-order-1", "polar-order-1"]);
  });

  it("acknowledges other event types with 202 and does nothing", async () => {
    const body = JSON.stringify({ type: "order.refunded", data: { id: "polar-order-1" } });
    const res = await POST(signedRequest(body));
    expect(res.status).toBe(202);
    expect(markPackagePaid).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it("rejects a signed but malformed JSON body with 400", async () => {
    const res = await POST(signedRequest("not-json{"));
    expect(res.status).toBe(400);
    expect(markPackagePaid).not.toHaveBeenCalled();
  });

  it("maps a worker provisioning failure to 502 so Polar retries", async () => {
    markPackagePaid.mockRejectedValue(new Error("worker POST failed: 500"));
    const res = await POST(signedRequest(orderPaidBody()));
    expect(res.status).toBe(502);
  });
});

describe("POST /api/webhooks/polar — customer-email fallback", () => {
  function packageSummary(overrides: Record<string, unknown> = {}) {
    return {
      id: "pkg-9",
      access_token: "tok-9",
      status: "ready",
      user_id: "user-9",
      total_sessions: 6,
      sessions_used: 1,
      role_title: "FDPM",
      is_trial: true,
      paid_at: null,
      expires_at: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    adminUsersResponse = new Response(
      JSON.stringify({ users: [{ id: "user-9", email: "tae@example.com" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  it("resolves the account by customer email when metadata is absent", async () => {
    listPackagesForUser.mockResolvedValue([packageSummary()]);
    const res = await POST(signedRequest(orderPaidBody({ metadata: {} })));
    expect(res.status).toBe(200);
    // The GoTrue admin lookup went out with the service key, never the
    // publishable one.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/auth/v1/admin/users");
    expect(fetchCalls[0].url).toContain(encodeURIComponent("tae@example.com"));
    const headers = new Headers(fetchCalls[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sb_secret_test");
    expect(listPackagesForUser).toHaveBeenCalledWith("user-9");
    expect(markPackagePaid).toHaveBeenCalledExactlyOnceWith(
      "pkg-9",
      expect.objectContaining({ user_id: "user-9", polar_order_id: "polar-order-1" }),
    );
  });

  it("keeps a metadata package_id and resolves only the missing user by email", async () => {
    const res = await POST(
      signedRequest(orderPaidBody({ metadata: { package_id: "pkg-1" } })),
    );
    expect(res.status).toBe(200);
    expect(markPackagePaid).toHaveBeenCalledExactlyOnceWith(
      "pkg-1",
      expect.objectContaining({ user_id: "user-9" }),
    );
    expect(listPackagesForUser).not.toHaveBeenCalled();
  });

  it("prefers the single unpaid trial when the user has several unpaid packages", async () => {
    listPackagesForUser.mockResolvedValue([
      packageSummary({ id: "pkg-8", is_trial: false }),
      packageSummary({ id: "pkg-9", is_trial: true }),
    ]);
    const res = await POST(signedRequest(orderPaidBody({ metadata: {} })));
    expect(res.status).toBe(200);
    expect(markPackagePaid).toHaveBeenCalledExactlyOnceWith(
      "pkg-9",
      expect.objectContaining({ user_id: "user-9" }),
    );
  });

  it("refuses to guess between multiple unpaid trials — 500, nothing provisioned", async () => {
    listPackagesForUser.mockResolvedValue([
      packageSummary({ id: "pkg-8" }),
      packageSummary({ id: "pkg-9" }),
    ]);
    const res = await POST(signedRequest(orderPaidBody({ metadata: {} })));
    expect(res.status).toBe(500);
    expect(markPackagePaid).not.toHaveBeenCalled();
  });

  it("returns 500 and provisions nothing when neither metadata nor email exists", async () => {
    const res = await POST(
      signedRequest(orderPaidBody({ metadata: {}, customer: {} })),
    );
    expect(res.status).toBe(500);
    expect(markPackagePaid).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it("returns 500 when the email matches no account", async () => {
    adminUsersResponse = new Response(JSON.stringify({ users: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const res = await POST(signedRequest(orderPaidBody({ metadata: {} })));
    expect(res.status).toBe(500);
    expect(markPackagePaid).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the fallback is needed but the service key is missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await POST(signedRequest(orderPaidBody({ metadata: {} })));
    expect(res.status).toBe(503);
    expect(markPackagePaid).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });
});
