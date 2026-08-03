// Thin server-side client for Polar, the merchant of record (v0.5).
//
// Two jobs only: create a HOSTED checkout session (the browser is redirected
// to Polar's page — no card fields in-app, ever) and verify Standard Webhooks
// signatures on the order.paid webhook with node:crypto (hand-rolled on
// purpose: ~20 lines beats a dependency for one HMAC).
//
// The "server-only" import makes any client-component import a build error:
// this module carries POLAR_ACCESS_TOKEN and must never reach the browser.
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export const POLAR_CHECKOUTS_URL = "https://api.polar.sh/v1/checkouts/";

/** Polar env vars are absent or empty — checkout cannot open. The page
 * renders an honest "payments are not available right now" state. */
export class PolarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolarConfigError";
  }
}

/** Polar replied but not usably (non-2xx, or 2xx without a hosted url). */
export class PolarApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PolarApiError";
    this.status = status;
  }
}

export interface PolarCheckout {
  id: string;
  url: string;
}

/**
 * Create a hosted checkout session for one package unlock. The metadata
 * carrier {package_id, user_id} is how order.paid finds its way back to the
 * package — the webhook route also keeps a customer-email fallback because
 * metadata propagation onto the order was unverified in recon.
 */
export async function createCheckout(input: {
  packageId: string;
  userId: string;
  successUrl: string;
}): Promise<PolarCheckout> {
  const token = process.env.POLAR_ACCESS_TOKEN;
  const productId = process.env.POLAR_PRODUCT_ID;
  if (!token || !productId) {
    throw new PolarConfigError("POLAR_ACCESS_TOKEN and POLAR_PRODUCT_ID must be set");
  }
  const response = await fetch(POLAR_CHECKOUTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      products: [productId],
      metadata: { package_id: input.packageId, user_id: input.userId },
      success_url: input.successUrl,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    // Status only — Polar error bodies are logged by the caller, never
    // rendered, so a provider message can't leak into UI copy.
    throw new PolarApiError(`Polar checkout create failed: ${response.status}`, response.status);
  }
  const body = (await response.json().catch(() => ({}))) as {
    id?: unknown;
    url?: unknown;
  };
  if (typeof body.id !== "string" || typeof body.url !== "string") {
    throw new PolarApiError("Polar checkout create returned no hosted url", response.status);
  }
  return { id: body.id, url: body.url };
}

// --- Standard Webhooks verification --------------------------------------
//
// Scheme (https://www.standardwebhooks.com/): the secret is "whsec_" + base64
// key bytes; the signed content is `{webhook-id}.{webhook-timestamp}.{rawBody}`;
// the webhook-signature header holds space-separated "v1,BASE64" entries and
// the payload is authentic if ANY v1 entry matches. Timestamps outside the
// tolerance window are rejected in BOTH directions — an old capture must not
// replay, and a far-future stamp is only ever a forgery.

export const WEBHOOK_TOLERANCE_S = 300;

const SECRET_PREFIX = "whsec_";

export type WebhookRejection =
  | "missing-headers"
  | "bad-secret"
  | "bad-timestamp"
  | "stale-timestamp"
  | "no-match";

export type WebhookVerification = { ok: true } | { ok: false; reason: WebhookRejection };

export function verifyWebhookSignature(input: {
  secret: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  rawBody: string;
  /** Injectable clock for tests; defaults to Date.now(). */
  nowMs?: number;
}): WebhookVerification {
  const { secret, webhookId, webhookTimestamp, webhookSignature, rawBody } = input;
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { ok: false, reason: "missing-headers" };
  }
  if (!secret.startsWith(SECRET_PREFIX)) {
    return { ok: false, reason: "bad-secret" };
  }
  const key = Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");
  if (key.length === 0) {
    return { ok: false, reason: "bad-secret" };
  }
  // Standard Webhooks timestamps are unix SECONDS, digits only. Number("")
  // is 0, so emptiness is already caught above.
  const timestamp = Number(webhookTimestamp);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "bad-timestamp" };
  }
  const nowS = (input.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowS - timestamp) > WEBHOOK_TOLERANCE_S) {
    return { ok: false, reason: "stale-timestamp" };
  }
  const expected = createHmac("sha256", key)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest();
  for (const entry of webhookSignature.split(" ")) {
    const [version, encoded] = entry.split(",", 2);
    if (version !== "v1" || !encoded) {
      continue;
    }
    const candidate = Buffer.from(encoded, "base64");
    // timingSafeEqual throws on length mismatch; a wrong-length MAC is just
    // a non-match, never a crash in the webhook route.
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "no-match" };
}
