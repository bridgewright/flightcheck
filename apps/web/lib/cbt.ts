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

export type CbtRedeemResult =
  | CbtRedeemSuccess
  | { code: "cbt-code-invalid" | "cbt-already-redeemed" | "cbt-full" | "cbt-closed" | "rate-limited" | "invalid" | "unknown" };

export function cbtRedeemCopy(result: CbtRedeemResult): string {
  if (!("code" in result)) {
    return `Code accepted. Your next three job-description registrations are free. The beta runs until ${betaDate(result.package_expires_at)}.`;
  }
  const copy = {
    "cbt-code-invalid": "That code is not recognized.",
    "cbt-already-redeemed": "This account already has beta access.",
    "cbt-full": "The beta is full.",
    "cbt-closed": "The beta has closed.",
    "rate-limited": "Too many attempts. Try again in a bit.",
    invalid: "Enter a code between 1 and 64 characters.",
    unknown: "We couldn't redeem that code. Try again.",
  } as const;
  return copy[result.code];
}

export function cbtEntitlementCopy(status: CbtStatus): string | null {
  if (status.packages_remaining === 0) return null;
  return `Beta access active: ${status.packages_remaining} of 3 free registrations left, until ${betaDate(status.package_expires_at)}.`;
}
