import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GET as getLlmsTxt, dynamic as llmsCaching } from "@/app/llms.txt/route";
import robots, { AI_CRAWLERS } from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DISALLOWED_PREFIXES, LLMS_TXT_PATH, PUBLIC_ROUTES, SITE_NAME, SITE_URL } from "@/app/site";
import { HERO } from "@/components/landing/copy";
import { EXPIRY_DAYS, PACKAGE_SESSIONS, PRICE_DISPLAY } from "@/lib/pricing";

// F-60. The layer above F-40's cards and sitemap: what an ANSWER engine reads.
// A search result quotes a title; an answer engine quotes claims, and a wrong
// claim about the price or the refund policy is a support ticket from someone
// the product never spoke to. So the contract under test is narrow: /llms.txt
// serves the product's own facts from the modules that own them, and nothing
// in it can drift from what the visible pages state.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

describe("GET /llms.txt", () => {
  const response = getLlmsTxt();

  it("serves plain text", async () => {
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("is static: the facts change at deploy time, not per request", () => {
    expect(llmsCaching).toBe("force-static");
  });
});

describe("the llms.txt document", () => {
  const text = () => getLlmsTxt().text();

  it("follows the convention: H1 first, the one-liner as a blockquote", async () => {
    const lines = (await text()).split("\n");
    expect(lines[0]).toBe(`# ${SITE_NAME}`);
    // The same sentence the landing page leads with, not a second draft of it.
    expect(lines).toContain(`> ${HERO.body}`);
  });

  it("quotes the commercial numbers the pricing module holds", async () => {
    const body = await text();
    expect(body).toContain(PRICE_DISPLAY);
    expect(body).toContain(`${PACKAGE_SESSIONS} sessions`);
    expect(body).toContain(`${EXPIRY_DAYS} days`);
  });

  it("links every public page, absolutely", async () => {
    const body = await text();
    for (const route of PUBLIC_ROUTES) {
      expect(body).toContain(`(${SITE_URL}${route.path})`);
    }
  });

  it("says plainly what the product is not", async () => {
    // The honesty half of F-60. The market's loudest tools sell live-interview
    // assistance; an engine that files this product with them has been told
    // otherwise in the product's own words.
    const body = (await text()).toLowerCase();
    expect(body).toContain("practice");
    expect(body).toContain("what it is not");
    expect(body).toContain("never joins");
  });

  it("keeps the register: no dashes, no raised voice, under 80 lines", async () => {
    const body = await text();
    expect(body).not.toMatch(/[—–]/);
    expect(body).not.toContain("!");
    expect(body.split("\n").length).toBeLessThan(80);
  });

  it("takes its numbers from the owning modules, never a literal", () => {
    // The same fragments tests/pricing-single-source.test.ts greps the buying
    // path for, applied to the one file engines will quote most.
    const source = read("app/llms.txt/route.ts");
    expect(source).toContain("@/lib/pricing");
    expect(source).not.toContain(`$${"49"}`);
    expect(source).not.toMatch(/\b6 sessions\b/);
    expect(source).not.toMatch(/\b30 days\b/);
    expect(source).not.toMatch(/\b14 days\b/);
  });

  it("stays out of the sitemap: it is a file for agents, not a page for the index", () => {
    // Judged rather than defaulted. The sitemap module is exactly
    // PUBLIC_ROUTES, each entry carrying page semantics (changeFrequency,
    // priority) that a text file does not have, and agents find /llms.txt by
    // convention at the site root, the same way crawlers find robots.txt.
    expect(sitemap().map((entry) => entry.url)).not.toContain(`${SITE_URL}${LLMS_TXT_PATH}`);
    // The two pages this feature decorates ARE in the sitemap already.
    const paths = PUBLIC_ROUTES.map((route) => route.path);
    expect(paths).toContain("/pricing");
    expect(paths).toContain("/faq");
  });
});

describe("the AI-crawler policy in robots.txt", () => {
  const result = robots();
  const rules = [result.rules ?? []].flat();

  it("names the answer-engine crawlers rather than leaving them implied", () => {
    // Allow-on-purpose is the policy: a wildcard allow reads as an accident
    // of defaults, a named rule reads as a decision, and the decision is what
    // DECISIONS records. The named set is the engines that answer product
    // questions today plus the opt-out agents (Google-Extended,
    // Applebot-Extended, CCBot) whose absence would read as a training-data
    // objection this product does not have.
    expect(AI_CRAWLERS).toEqual([
      "GPTBot",
      "ClaudeBot",
      "Claude-Web",
      "PerplexityBot",
      "Google-Extended",
      "Applebot-Extended",
      "CCBot",
    ]);
    const agents = rules.map((rule) => rule.userAgent);
    expect(agents).toContain("*");
    for (const crawler of AI_CRAWLERS) {
      expect(agents).toContain(crawler);
    }
  });

  it("keeps the default rule first, where the F-40 contract reads it", () => {
    expect(rules[0]?.userAgent).toBe("*");
  });

  it("holds every agent to the same disallow list, /p/ above all", () => {
    // Allowing an AI crawler is a policy about PUBLIC pages. The /p/
    // capability-link space carries the token in the path, so one crawled URL
    // is a customer's report published to the open web; no named agent gets a
    // narrower disallow than the wildcard.
    expect(rules.length).toBeGreaterThan(1);
    for (const rule of rules) {
      const disallow = [rule.disallow ?? []].flat();
      expect(disallow).toEqual(DISALLOWED_PREFIXES);
      expect(disallow).toContain("/p/");
    }
  });

  it("allows every public page and llms.txt for every agent", () => {
    for (const rule of rules) {
      const allow = [rule.allow ?? []].flat();
      for (const route of PUBLIC_ROUTES) {
        expect(allow).toContain(route.path);
      }
      expect(allow).toContain(LLMS_TXT_PATH);
    }
  });
});
