import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PRICING, PRICING_LINES } from "@/components/landing/copy";
import { REFUND_WINDOW_DAYS } from "@/app/legal/policy";
import { EXPIRY_DAYS, PACKAGE_SESSIONS, PRICE_DISPLAY } from "@/lib/pricing";

// F-43. The commercial numbers appear on five surfaces — landing, pricing,
// checkout, legal, and the paywall block they share — and a price that drifts
// between the page someone read and the page that charges them is the kind of
// defect that ends in a chargeback rather than a bug report.
//
// lib/pricing.ts and app/legal/policy.ts own the numbers. These tests are the
// standing version of "grep for a bare 49": a literal reintroduced anywhere
// in the buying path fails the suite.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

// Every file between a visitor reading the price and the payment redirect.
const BUYING_PATH = [
  "app/page.tsx",
  "app/pricing/page.tsx",
  "app/checkout/page.tsx",
  "components/landing/copy.ts",
  "components/landing/PricingBlock.tsx",
];

describe("no commercial number is a literal on the buying path", () => {
  it.each(BUYING_PATH)("%s quotes no bare price or package size", (file) => {
    const source = read(file);
    // Written as fragments so this file's own assertions do not trip the
    // grep a future reader runs over the tree.
    expect(source).not.toContain(`$${"49"}`);
    expect(source).not.toMatch(/\b6 sessions\b/);
    expect(source).not.toMatch(/\b30 days\b/);
    expect(source).not.toMatch(/\b14 days\b/);
    expect(source).not.toContain("89,000");
    expect(source).not.toContain("₩");
  });
});

describe("the itemized unlock list", () => {
  it("names all five things a package buys", () => {
    // The dossier's paywall pattern: itemize what unlocks ABOVE the number,
    // so the price is read against something concrete.
    expect(PRICING_LINES).toHaveLength(5);
    const labels = PRICING_LINES.map((line) => line.label).join(" | ");
    expect(labels).toContain("1 job description");
    expect(labels).toContain(`${PACKAGE_SESSIONS} sessions`);
    expect(labels).toContain(`${EXPIRY_DAYS} days`);
    expect(labels.toLowerCase()).toContain("report");
    expect(labels.toLowerCase()).toContain("verdict");
  });

  it("renders the price from the pricing module", () => {
    expect(PRICING.price).toBe(PRICE_DISPLAY);
  });

  it("states the refund window from the policy module", () => {
    expect(PRICING.refundLine).toContain(`${REFUND_WINDOW_DAYS} days`);
  });
});

describe("the paywall block", () => {
  const source = read("components/landing/PricingBlock.tsx");
  // Comments explain what is deliberately absent, and naming a pattern in
  // prose is not shipping it. The scans below read the code only.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("puts the refund sentence directly above the button", () => {
    // Position is the point: the sentence has to be where the hesitation is,
    // not three clicks away in a policy page.
    const refundAt = code.indexOf("PRICING.refundLine");
    const buttonAt = code.indexOf("href={ctaHref}");
    expect(refundAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(refundAt);
  });

  it("puts the itemized list above the price", () => {
    expect(code.indexOf("PRICING_LINES")).toBeLessThan(code.indexOf("PRICING.price"));
  });

  it("manufactures no urgency", () => {
    // Documented absence, not an oversight: no countdown, no struck-through
    // anchor price, no seat counter. A product whose verdicts have to be
    // trusted cannot manufacture urgency about them.
    for (const pattern of ["countdown", "expires in", "seats left", "% off"]) {
      expect(code.toLowerCase()).not.toContain(pattern);
    }
  });

  it("is the one component both the landing and /pricing render", () => {
    expect(read("app/page.tsx")).toContain("PricingBlock");
    expect(read("app/pricing/page.tsx")).toContain("PricingBlock");
  });
});
