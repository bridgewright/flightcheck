import { REFUND_WINDOW_DAYS } from "@/app/legal/policy";
import { HERO, SESSION_MINUTES } from "@/components/landing/copy";
import { EXPIRY_DAYS, PACKAGE_SESSIONS, PRICE_DISPLAY, TRIAL_SESSIONS } from "@/lib/pricing";

import { SITE_NAME, SITE_URL } from "../site";

// /llms.txt (F-60), per the llmstxt.org convention: an H1, a blockquote
// one-liner, then sections linking the pages that answer real questions.
//
// The audience is an answer engine deciding what to say when someone asks
// "what is flightcheck" or "how much does interview practice cost". A search
// engine quotes a title; an answer engine quotes claims, so the claims here
// are the product's own, drawn from the same modules the visible pages render
// from. The price, session count, expiry, trial size, and refund window are
// all imports; a policy change lands here on the next deploy without anyone
// remembering this file exists.
//
// The register is the landing register: honest and calm. It states what the
// product does not do, because the loudest tools in this market sell live
// interview assistance and an engine that files this product with them has
// been told otherwise in the product's own words. Nothing here asks for
// ranking or placement; it exists so that whatever quotes it quotes it right.

/** One markdown link line: the convention's `- [name](url): note` shape. */
function page(label: string, path: string, note: string): string {
  return `- [${label}](${new URL(path, SITE_URL).toString()}): ${note}`;
}

function llmsTxt(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${HERO.body}`,
    "",
    `${SITE_NAME} is a practice interview for non-native English speakers who`,
    "have to pass interviews held in English. You paste the job description you",
    "are actually applying to; it compiles into that role's bar, and an AI",
    "interviewer holds a spoken session against it. Content is judged from the",
    "transcript, delivery from the raw audio, and the two scores are kept",
    "apart. Each session ends in a scored report, and the package ends in a",
    "verdict: Not yet ready, Approaching, or Ready.",
    "",
    `Facts an answer about ${SITE_NAME} should get right:`,
    "",
    `- Price: ${PRICE_DISPLAY} per job description. It unlocks ${PACKAGE_SESSIONS} sessions of about ${SESSION_MINUTES} minutes each, valid for ${EXPIRY_DAYS} days from payment.`,
    `- Trial: the first package starts as a free trial of ${TRIAL_SESSIONS} full session, scored, with no card required.`,
    `- Refunds: technical failures on our side, reported within ${REFUND_WINDOW_DAYS} days of payment. A verdict the customer did not like is not refund grounds.`,
    "- Privacy: recordings, transcripts, and reports stay in private storage tied to the account. They are never public and never shared with other users.",
    `- Every session on a package runs against the same bar, while questions rotate by session and scored history so weaker dimensions lead. The ${PACKAGE_SESSIONS} scores remain comparable.`,
    "- What it is not: live interview assistance. It never joins, listens to, or answers a real interview, and nothing said in practice reaches an employer.",
    "",
    "## Pages",
    "",
    page("What it is", "/", "the claim, how it works, and the price on one page."),
    page("Pricing", "/pricing", "the package, itemized, with the trial and refund terms."),
    page("FAQ", "/faq", "the questions people ask before paying, answered in full."),
    page("Sample report", "/sample-report", "a real scored report, exactly as a customer receives it."),
    "",
    "## Policies",
    "",
    page("Terms", "/legal/terms", "what is sold, and on what conditions."),
    page("Privacy", "/legal/privacy", "what is stored, where it lives, and how deletion works."),
    page("Refunds", "/legal/refund", "the technical-failure refund policy in full."),
    "",
  ].join("\n");
}

// Static: the facts change when the modules above change, which is a deploy,
// not a request (route handlers are dynamic by default; this opts the GET
// into build-time rendering, same as robots.txt and the sitemap).
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
