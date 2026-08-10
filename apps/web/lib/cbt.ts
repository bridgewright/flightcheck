import type { CbtRedeemSuccess, CbtStatus } from "@/lib/types";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function betaDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

// The refusal half is the honest shape of what response.json() actually
// returns: an unvalidated { code } whose value the web cannot close over —
// the route's own 401 says "unauthorized", and a future worker may refuse
// with codes this table has not caught up with.
export type CbtRedeemResult = CbtRedeemSuccess | { code: string };

const GENERIC_REDEEM_COPY = "We couldn't redeem that code. Try again.";

/**
 * The result the redeem surface renders, derived from what the wire actually
 * said. The STATUS is the discriminator, never the body's shape: the earlier
 * check (`"code" in body`) declared any codeless body a success, so a refusal
 * whose JSON carried no `code` key rendered "Code accepted ... until
 * undefined." A 2xx whose body is not the contract's success shape is a
 * broken deploy, and the honest sentence for that is the generic one — the
 * post-redeem refresh still shows the true entitlement state.
 */
export function cbtRedeemResult(status: number, body: unknown): CbtRedeemResult {
  if (status === 429) return { code: "rate-limited" };
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  if (status >= 200 && status < 300) {
    return record && typeof record.label === "string" && typeof record.package_expires_at === "string"
      ? (record as unknown as CbtRedeemSuccess)
      : { code: "unknown" };
  }
  return { code: typeof record?.code === "string" ? record.code : "unknown" };
}

export function cbtRedeemCopy(result: CbtRedeemResult): string {
  if (!("code" in result)) {
    return `Code accepted. Your next three job-description registrations are free. The beta runs until ${betaDate(result.package_expires_at)}.`;
  }
  const copy: Record<string, string> = {
    "cbt-code-invalid": "That code is not recognized.",
    "cbt-already-redeemed": "This account already has beta access.",
    "cbt-full": "The beta is full.",
    "cbt-closed": "The beta has closed.",
    "rate-limited": "Too many attempts. Try again in a bit.",
    invalid: "Enter a code between 1 and 64 characters.",
    unknown: GENERIC_REDEEM_COPY,
  };
  return copy[result.code] ?? GENERIC_REDEEM_COPY;
}

export function cbtEntitlementCopy(status: CbtStatus): string | null {
  if (status.packages_remaining === 0) return null;
  return `Beta access active: ${status.packages_remaining} of 3 free registrations left, until ${betaDate(status.package_expires_at)}.`;
}
