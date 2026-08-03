import { NextResponse } from "next/server";

import { verifyWebhookSignature } from "@/lib/polar";
import { SUPABASE_URL } from "@/lib/supabase/config";
import type { PaidOrderBody } from "@/lib/worker";
import { listPackagesForUser, markPackagePaid } from "@/lib/worker";

// POST /api/webhooks/polar — the provisioning door. Polar (the merchant of
// record) calls this on order.paid; the route verifies the Standard Webhooks
// signature over the RAW body, resolves which package the payment unlocks,
// and forwards to the worker's idempotent markPackagePaid. Everything else
// fails closed:
//
// - No POLAR_WEBHOOK_SECRET configured → 503, never process. A webhook door
//   that waves payloads through unverified would let anyone provision
//   sessions with a curl.
// - Signature invalid in any way → 403, provisions nothing.
// - Cannot resolve the order to exactly one package → 5xx so Polar retries
//   and the failure is visible in logs; guessing would unlock the wrong
//   package, and a 2xx would ack a payment that provisioned nothing.
// - Replayed events are safe end-to-end: the worker dedupes on
//   polar_order_id, so this route simply forwards the same key again.
//
// The order→account carrier is metadata {package_id, user_id} set at
// checkout creation (lib/polar.createCheckout). Metadata propagation onto
// the order was unverified in recon, so a customer-email → auth.users
// fallback exists and both paths are tested. Per DECISIONS 012, provisioning
// never mints token links — the package's owner reaches it through their
// signed-in account.

interface PolarEvent {
  type?: unknown;
  data?: {
    id?: unknown;
    checkout_id?: unknown;
    total_amount?: unknown;
    amount?: unknown;
    currency?: unknown;
    paid_at?: unknown;
    created_at?: unknown;
    customer?: { email?: unknown };
    metadata?: Record<string, unknown>;
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** GoTrue admin lookup: exact-email match among the filter results. Returns
 * the auth.users id, or null when no account carries that email. */
async function findUserIdByEmail(email: string, serviceKey: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`;
  const response = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`auth admin lookup failed: ${response.status}`);
  }
  const body = (await response.json().catch(() => ({}))) as {
    users?: { id?: unknown; email?: unknown }[];
  };
  const wanted = email.toLowerCase();
  const match = (body.users ?? []).find(
    (user) => typeof user.email === "string" && user.email.toLowerCase() === wanted,
  );
  return typeof match?.id === "string" ? match.id : null;
}

/** Which of the user's packages this payment unlocks, when metadata did not
 * say: the single unpaid package, else the single unpaid trial. Anything
 * ambiguous is a refusal — the caller maps null to a retryable 5xx. */
async function findUnlockablePackageId(userId: string): Promise<string | null> {
  const packages = await listPackagesForUser(userId);
  const unpaid = packages.filter((pkg) => !pkg.paid_at);
  if (unpaid.length === 1) {
    return unpaid[0].id;
  }
  const trials = unpaid.filter((pkg) => pkg.is_trial === true);
  return trials.length === 1 ? trials[0].id : null;
}

export async function POST(request: Request) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("polar webhook: POLAR_WEBHOOK_SECRET is not set — failing closed");
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const verification = verifyWebhookSignature({
    secret,
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
    rawBody,
  });
  if (!verification.ok) {
    console.error(`polar webhook: signature rejected (${verification.reason})`);
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  let event: PolarEvent;
  try {
    event = JSON.parse(rawBody) as PolarEvent;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (event.type !== "order.paid") {
    // Authentic but not the provisioning event — acknowledged and ignored.
    return NextResponse.json({ ignored: true }, { status: 202 });
  }

  const data = event.data ?? {};
  const polarOrderId = asString(data.id);
  if (!polarOrderId) {
    console.error("polar webhook: order.paid without an order id");
    return NextResponse.json({ error: "order id missing" }, { status: 400 });
  }

  // --- Resolve the account and package: metadata first, email fallback ---
  const metadata = data.metadata ?? {};
  let userId = asString(metadata.user_id);
  let packageId = asString(metadata.package_id);

  if (!userId || !packageId) {
    const email = asString(data.customer?.email);
    if (!userId) {
      if (!email) {
        console.error(
          `polar webhook: order ${polarOrderId} carries no metadata and no customer email`,
        );
        return NextResponse.json({ error: "cannot resolve the order to an account" }, { status: 500 });
      }
      const serviceKey =
        process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) {
        console.error(
          "polar webhook: email fallback needed but no Supabase service key is set — failing closed",
        );
        return NextResponse.json({ error: "account lookup not configured" }, { status: 503 });
      }
      try {
        userId = await findUserIdByEmail(email, serviceKey);
      } catch (err) {
        console.error("polar webhook: auth admin lookup failed", err);
        return NextResponse.json({ error: "account lookup failed" }, { status: 502 });
      }
      if (!userId) {
        console.error(`polar webhook: order ${polarOrderId} email matches no account`);
        return NextResponse.json({ error: "no account for that email" }, { status: 500 });
      }
    }
    if (!packageId) {
      try {
        packageId = await findUnlockablePackageId(userId);
      } catch (err) {
        console.error("polar webhook: package lookup failed", err);
        return NextResponse.json({ error: "package lookup failed" }, { status: 502 });
      }
      if (!packageId) {
        console.error(
          `polar webhook: order ${polarOrderId} cannot be resolved to exactly one package`,
        );
        return NextResponse.json(
          { error: "cannot resolve the order to a package" },
          { status: 500 },
        );
      }
    }
  }

  // The 30-day window starts at the payment moment Polar reports, not at
  // webhook-processing time (a retried delivery must not extend the window).
  const paidAt =
    asString(data.paid_at) ?? asString(data.created_at) ?? new Date().toISOString();
  const amountMinor =
    typeof data.total_amount === "number"
      ? data.total_amount
      : typeof data.amount === "number"
        ? data.amount
        : null;

  const order: PaidOrderBody = {
    user_id: userId,
    polar_order_id: polarOrderId,
    polar_checkout_id: asString(data.checkout_id),
    amount_minor: amountMinor,
    currency: asString(data.currency),
    status: "paid",
    paid_at: paidAt,
  };

  try {
    await markPackagePaid(packageId, order);
  } catch (err) {
    console.error(`polar webhook: provisioning failed for order ${polarOrderId}`, err);
    return NextResponse.json({ error: "provisioning failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
