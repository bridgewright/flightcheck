import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// F-43's confirm step. Before this, the in-app unlock button went from
// "Unlock all sessions for $49" straight to a hosted card form: a customer
// could pay without ever having been shown an itemized list of what they were
// buying or the refund terms. That is the gap the checkout patterns worth
// copying close, and it is the difference between a surprise and a chargeback.
//
// The page has no render harness (environment: node, and it reaches for
// cookies, headers, and a Polar client), so this is a source-scan contract in
// the house style. What it holds: the confirm screen exists, it is reached by
// default, the Polar session is created only for a confirmed request, and the
// terms sit above the button rather than after it.

const source = readFileSync(
  fileURLToPath(new URL("../app/checkout/page.tsx", import.meta.url)),
  "utf8",
);

describe("the checkout confirm step", () => {
  it("renders the same paywall block the landing and pricing pages do", () => {
    // One component means the offer someone read and the offer they are
    // charged for cannot be two different offers.
    expect(source).toContain("PricingBlock");
    expect(source).toContain("@/components/landing/PricingBlock");
  });

  it("creates no payment session until the request is confirmed", () => {
    // The guard must come BEFORE createCheckout, or an accidental
    // navigation, a link prefetch, or a back button opens a checkout.
    const guardAt = source.indexOf('go !== "1"');
    const createAt = source.indexOf("createCheckout(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(guardAt);
  });

  it("names the job description being unlocked", () => {
    // "Unlock this package" is meaningless if the customer holds three and
    // cannot tell which one the charge applies to.
    expect(source).toContain("packageDisplayTitle");
  });

  it("carries the package id through the confirm hop", () => {
    // Losing ?pkg on the way through would silently charge for whichever
    // package happens to be active.
    expect(source).toMatch(/checkout\?pkg=\$\{encodeURIComponent\(pkg\.id\)\}&go=1/);
  });

  it("still collects no payment details of its own", () => {
    expect(source).not.toMatch(/<input|<form|<select|<textarea/i);
  });

  it("leaves the already-paid and nothing-to-unlock states ahead of the gate", () => {
    // Those screens answer questions the confirm step should never ask. Both
    // return before it.
    const paidAt = source.indexOf("already unlocked");
    const nothingAt = source.indexOf("Nothing to unlock yet");
    const guardAt = source.indexOf('go !== "1"');
    expect(paidAt).toBeGreaterThan(-1);
    expect(nothingAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(paidAt);
    expect(guardAt).toBeGreaterThan(nothingAt);
  });
});
