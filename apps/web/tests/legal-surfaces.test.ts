import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FOOTER_LINKS } from "@/app/legal/policy";

// The legal surfaces have no render harness (environment: node, no jsdom),
// so these scan source instead — the same pattern as token-in-href.test.ts.
// What they pin: every number in legal copy comes from lib/pricing.ts or
// app/legal/policy.ts (never a literal), the footer is single-sourced from
// the policy module, and the pages make the promises the policy set requires
// (honest-verdict clause, refund window, retention and deletion).

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

describe("Shell footer", () => {
  const shell = () => read("components/Shell.tsx");

  it("renders the footer links from the policy module, not literals", () => {
    // FOOTER_LINKS, which spreads LEGAL_LINKS and puts /faq ahead of it. The
    // split exists because the FAQ is not a legal page and legal-policy.test.ts
    // pins LEGAL_LINKS to exactly the three that are.
    expect(shell()).toContain("FOOTER_LINKS");
    expect(shell()).not.toContain('href="/legal/');
  });

  it("gives /faq the only route into it that exists", () => {
    // The batch moved the objection block off the landing to its own route and
    // added that route to PUBLIC_ROUTES, so the sitemap published it and robots
    // allowed it while nothing on the site linked to it. A crawler could reach
    // the answers and a visitor deciding whether to spend $49 could not.
    expect(FOOTER_LINKS.map((link) => link.href)).toContain("/faq");
  });

  it("offers the support mailto from the policy module", () => {
    expect(shell()).toContain("supportMailto");
    expect(shell()).toContain("Support");
  });
});

describe("legal pages", () => {
  const terms = () => read("app/legal/terms/page.tsx");
  const privacy = () => read("app/legal/privacy/page.tsx");
  const refund = () => read("app/legal/refund/page.tsx");

  it("terms takes every commercial number from lib/pricing.ts", () => {
    const source = terms();
    expect(source).toContain("@/lib/pricing");
    for (const identifier of [
      "PRICE_DISPLAY",
      "PACKAGE_SESSIONS",
      "EXPIRY_DAYS",
    ]) {
      expect(source).toContain(identifier);
    }
  });

  it("terms carries the honest-verdict clause in the product's words", () => {
    expect(terms()).toContain("Not yet ready");
  });

  it("refund states the technical-failure window from the policy module", () => {
    const source = refund();
    expect(source).toContain("REFUND_WINDOW_DAYS");
    expect(source).toContain("SUPPORT_EMAIL");
  });

  it("privacy points deletion at the settings intake with its timeline", () => {
    const source = privacy();
    expect(source).toContain("/settings");
    expect(source).toContain("DELETION_TIMELINE_DAYS");
  });

  it("no legal page hardcodes a price", () => {
    for (const source of [terms(), privacy(), refund()]) {
      expect(source).not.toContain("$49");
      expect(source).not.toContain("89,000");
      expect(source).not.toContain("₩"); // ₩ must not appear anywhere (spec)
    }
  });

  it("every legal page renders inside the Shell chrome", () => {
    for (const source of [terms(), privacy(), refund()]) {
      expect(source).toContain("Shell");
    }
  });
});
