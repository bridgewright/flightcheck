import { describe, expect, it } from "vitest";

import {
  DELETION_SUBJECT,
  DELETION_TIMELINE_DAYS,
  LEGAL_LINKS,
  REFUND_WINDOW_DAYS,
  SUPPORT_EMAIL,
  deletionMailto,
  supportMailto,
} from "@/app/legal/policy";

// Pinning tests: these constants ARE the trust policy the legal pages,
// footer, and settings intake state. lib/pricing.ts owns the commercial
// numbers ($49 / 6 sessions / 30 days); this module owns the legal ones
// (refund window, deletion timeline, support address) so a change fails
// loudly here instead of drifting between the refund page and the terms.
describe("legal policy constants", () => {
  it("pins the 14-day technical-failure refund window (DECISIONS 020)", () => {
    expect(REFUND_WINDOW_DAYS).toBe(14);
  });

  it("pins the 7-day manual deletion timeline", () => {
    expect(DELETION_TIMELINE_DAYS).toBe(7);
  });

  it("pins the support address and its mailto", () => {
    // The branded address, deliberately (DECISIONS 069). A regression to a
    // personal mailbox is exactly what this pin exists to refuse.
    expect(SUPPORT_EMAIL).toBe("support@flightcheck.coach");
    expect(supportMailto()).toBe("mailto:support@flightcheck.coach");
  });

  it("lists exactly the three legal pages the footer links", () => {
    expect(LEGAL_LINKS.map((link) => link.href)).toEqual([
      "/legal/terms",
      "/legal/privacy",
      "/legal/refund",
    ]);
  });
});

describe("deletionMailto", () => {
  it("targets support with the prefilled deletion subject", () => {
    const url = deletionMailto("someone@example.com");
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    expect(url).toContain(`subject=${encodeURIComponent(DELETION_SUBJECT)}`);
    expect(DELETION_SUBJECT).toBe("Delete my flightcheck account");
  });

  it("names the account address in the body so the right account is purged", () => {
    const url = deletionMailto("someone@example.com");
    expect(decodeURIComponent(url)).toContain("someone@example.com");
  });

  it("still produces a sendable request when no email is on record", () => {
    const url = deletionMailto(null);
    expect(url).toContain(`subject=${encodeURIComponent(DELETION_SUBJECT)}`);
    expect(decodeURIComponent(url)).not.toContain("null");
  });
});
