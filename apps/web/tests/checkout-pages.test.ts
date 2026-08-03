import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source pins for the checkout surfaces (style of token-in-href.test.ts —
// the screens have no render harness, so their source is scanned instead).
// Two release-blocking properties live here:
//
// 1. Hosted checkout ONLY. Polar is the merchant of record; this app must
//    never render a card field or any payment form of its own. The checkout
//    page's header comment states the rule and is the acceptance criterion.
// 2. Checkout, success, and cancel are noindex: transactional pages tied to
//    an account have no business in a search index.

const PAGES: [name: string, relPath: string][] = [
  ["checkout", "../app/checkout/page.tsx"],
  ["success", "../app/checkout/success/page.tsx"],
  ["cancel", "../app/checkout/cancel/page.tsx"],
];

function source(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

describe("no payment details are ever collected in-app", () => {
  it.each(PAGES)("the %s page renders no input or form element", (_name, relPath) => {
    expect(source(relPath)).not.toMatch(/<input|<form|<select|<textarea/i);
  });

  it("the checkout page states the hosted-only rule (acceptance criterion)", () => {
    expect(source("../app/checkout/page.tsx").toLowerCase()).toContain("no card fields");
  });
});

describe("checkout surfaces are noindex", () => {
  it.each(PAGES)("the %s page exports robots noindex metadata", (_name, relPath) => {
    expect(source(relPath)).toMatch(/robots:\s*\{[^}]*index:\s*false/);
  });
});
