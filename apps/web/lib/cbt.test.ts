import { describe, expect, it } from "vitest";

import { cbtEntitlementCopy, cbtRedeemCopy } from "@/lib/cbt";

describe("CBT copy", () => {
  const expiry = "2026-08-31T23:59:59Z";

  it("describes the grant as future registrations, not existing packages", () => {
    expect(cbtRedeemCopy({ label: "Founding beta", packages_remaining: 3, package_expires_at: expiry })).toBe(
      "Code accepted. Your next three job-description registrations are free. The beta runs until Aug 31, 2026.",
    );
  });

  it.each([
    ["cbt-code-invalid", "That code is not recognized."],
    ["cbt-already-redeemed", "This account already has beta access."],
    ["cbt-full", "The beta is full."],
    ["cbt-closed", "The beta has closed."],
    ["rate-limited", "Too many attempts. Try again in a bit."],
    ["invalid", "Enter a code between 1 and 64 characters."],
    ["unknown", "We couldn't redeem that code. Try again."],
  ] as const)("maps %s to honest copy", (code, copy) => {
    expect(cbtRedeemCopy({ code })).toBe(copy);
  });

  it("falls back to the generic sentence for a code it does not know", () => {
    // The route's own 401 body is { code: "unauthorized" }, and a future
    // worker may refuse with codes this table has not caught up with. A
    // lookup miss must not render silence.
    expect(cbtRedeemCopy({ code: "unauthorized" })).toBe("We couldn't redeem that code. Try again.");
  });

  it("keeps an unparseable expiry date as-is instead of crashing", () => {
    expect(cbtRedeemCopy({ label: "Founding beta", packages_remaining: 3, package_expires_at: "soon" })).toBe(
      "Code accepted. Your next three job-description registrations are free. The beta runs until soon.",
    );
  });

  it("shows remaining registrations and hides a spent entitlement", () => {
    expect(cbtEntitlementCopy({ label: "Founding beta", packages_granted: 1, packages_remaining: 2, package_expires_at: expiry })).toBe(
      "Beta access active: 2 of 3 free registrations left, until Aug 31, 2026.",
    );
    expect(cbtEntitlementCopy({ label: "Founding beta", packages_granted: 3, packages_remaining: 0, package_expires_at: expiry })).toBeNull();
  });
});
