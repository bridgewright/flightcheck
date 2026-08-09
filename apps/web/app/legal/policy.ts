// The trust-policy constants and helpers for the legal surfaces. lib/pricing.ts
// owns the commercial numbers ($49 / 6 sessions / 30 days);
// this module owns the legal ones — refund window, deletion timeline, support
// address — plus the mailto builders the footer and settings intake share.
// REFUND_WINDOW_DAYS lives here rather than in lib/pricing.ts because Phase 0
// pinned pricing.ts to the commercial policy and the refund window is legal
// policy (DECISIONS 020 records the 14-day choice).

export const SUPPORT_EMAIL = "thk119914@gmail.com";

// Technical-failure refunds only, within this many days of payment. The
// verdict itself is never refund grounds — an honest "Not yet ready" is the
// product working, not failing.
export const REFUND_WINDOW_DAYS = 14;

// Self-serve deletion has shipped: /settings deletes the account immediately
// (app/api/account/delete, covered by tests/account-delete-route.test.ts), and
// the privacy page says so. This window is the fallback path only — a customer
// who would rather we did it, or who can no longer sign in, emails from their
// account address and we purge within this many days.
export const DELETION_TIMELINE_DAYS = 7;

export const DELETION_SUBJECT = "Delete my flightcheck account";

export const LEGAL_LINKS = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/refund", label: "Refunds" },
] as const;

/**
 * What the footer actually renders: the FAQ, then the policies.
 *
 * Separate from LEGAL_LINKS because the FAQ is not a legal page, and a test
 * pins LEGAL_LINKS to exactly the three that are.
 *
 * The FAQ is in this list because it was reachable from nowhere. The batch
 * moved the objection block off the landing onto its own route and added that
 * route to PUBLIC_ROUTES, so `sitemap.ts` published it and `robots.ts` allowed
 * it: a crawler could find the answers and a customer about to spend $49 could
 * not. Two separate files described the click that had never been built.
 */
export const FOOTER_LINKS = [
  { href: "/faq", label: "FAQ" },
  ...LEGAL_LINKS,
  { href: "/feedback", label: "Feedback" },
] as const;

export function supportMailto(): string {
  return `mailto:${SUPPORT_EMAIL}`;
}

// The deletion intake link on /settings. Naming the account address in the
// body means the operator purges the right account even when the message
// arrives from a different mailbox; without one on record the sender must
// write from the account address so we can attribute the request at all.
export function deletionMailto(accountEmail: string | null): string {
  const body = accountEmail
    ? `Please delete the flightcheck account registered to ${accountEmail} and all data attached to it.`
    : "Please delete my flightcheck account and all data attached to it. " +
      "I am writing from the address the account is registered to.";
  // encodeURIComponent, not URLSearchParams: the latter encodes spaces as
  // "+", which mail clients render literally in mailto bodies.
  const subject = encodeURIComponent(DELETION_SUBJECT);
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${encodeURIComponent(body)}`;
}
