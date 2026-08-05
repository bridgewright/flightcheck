import type { MetadataRoute } from "next";

import { DISALLOWED_PREFIXES, LLMS_TXT_PATH, PUBLIC_ROUTES, SITE_URL } from "./site";

// robots.txt, generated from the same route tables the sitemap uses, so the
// two can never disagree about what "public" means.
//
// The disallow list is the load-bearing half. `/p/` in particular: those URLs
// carry a capability token in the path, so a crawled one is a customer's
// report published to the open web. The signed-in app routes are listed for
// the ordinary reason — they redirect a signed-out crawler anyway, and there
// is nothing there for a search result to point at.
//
// Note what this does NOT claim to do: robots.txt is a request, not an access
// control. The token routes are also guarded server-side; this keeps honest
// crawlers out of places that would waste their time and ours.
//
// The AI crawlers are named on purpose (F-60). Every rule below says the same
// thing, so the named rules add no reach a wildcard did not already grant;
// what they add is that the allowing is legible as a decision rather than as
// an accident of defaults. This product wants to be found and quoted
// correctly by answer engines, and it wants the /p/ capability-link space
// kept out of every index and every training set, so each named agent gets
// the full disallow list, never a narrower one. DECISIONS records the choice.

/**
 * The answer-engine and AI-training crawlers allowed by name: the agents that
 * answer product questions today (GPTBot, ClaudeBot, Claude-Web,
 * PerplexityBot) and the opt-out agents (Google-Extended, Applebot-Extended,
 * CCBot) whose absence would read as a training-data objection this product
 * does not have.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

/** What "public" means for every agent: the sitemap's pages plus llms.txt. */
const CRAWLABLE = [...PUBLIC_ROUTES.map((route) => route.path), LLMS_TXT_PATH];

function rule(userAgent: string) {
  return { userAgent, allow: CRAWLABLE, disallow: DISALLOWED_PREFIXES };
}

export default function robots(): MetadataRoute.Robots {
  return {
    // The wildcard rule stays first: it is the one the F-40 contract in
    // tests/link-sharing.test.ts reads, and the one an unnamed crawler obeys.
    rules: [rule("*"), ...AI_CRAWLERS.map(rule)],
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
    host: SITE_URL,
  };
}
