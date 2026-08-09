import type { Metadata } from "next";

import { FAQ, HERO } from "@/components/landing/copy";
import { PRICE_USD } from "@/lib/pricing";

// The site's identity, in one place, for every surface that has to name it:
// per-page metadata, the OG card, robots.txt, and the sitemap.
//
// F-40 exists because of a specific moment: a reviewer pastes a link to this
// product into Slack. What unfurls there is the first and sometimes only
// impression. A missing card, a "localhost" image URL, or a title that says
// "Create Next App" costs more than the page it points at earns.
//
// It also exists because of the opposite moment: a capability-token report
// link, or a signed-in dashboard, appearing in a search index. Those are
// listed here too, as the things that must never be crawled.

/** The canonical origin. Absolute URLs everywhere — a relative OG image
 * resolves against Next's default base, which on Vercel is the per-deployment
 * hostname rather than the address anyone actually shares. */
export const SITE_URL = "https://flightcheck.vercel.app";

export const SITE_NAME = "flightcheck";

export interface PublicRoute {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
}

/**
 * Every page a stranger is meant to find. This list is the sitemap, and it is
 * also the definition of "public" that robots.ts works against — one table
 * rather than two that drift.
 */
export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/quick", changeFrequency: "monthly", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.6 },
  { path: "/sample-report", changeFrequency: "monthly", priority: 0.8 },
  { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/refund", changeFrequency: "yearly", priority: 0.3 },
];

/**
 * The llms.txt document (F-60), served by app/llms.txt/route.ts. Not a
 * PublicRoute: PUBLIC_ROUTES is the sitemap, and the sitemap's entries carry
 * page semantics (changeFrequency, priority) that a text file for agents does
 * not have. Agents find it by convention at the site root, the way crawlers
 * find robots.txt; robots.ts allows it explicitly for the same reason it
 * allows the public pages explicitly.
 */
export const LLMS_TXT_PATH = "/llms.txt";

/**
 * Paths no crawler should follow.
 *
 * Three kinds, and the reasons differ. Auth-gated app routes hold one
 * account's work and answer a signed-out crawler with a redirect anyway.
 * Checkout and its outcomes are transactional. `/p/` is the sharp one: those
 * URLs ARE the capability — the token is in the path — so indexing one would
 * publish a customer's report.
 */
export const DISALLOWED_PREFIXES = [
  "/api/",
  "/auth/",
  "/checkout",
  "/dev/",
  "/feedback",
  "/home",
  "/login",
  "/new",
  "/ops/",
  "/p/",
  "/packages",
  "/progress",
  "/quick/report",
  "/rubric",
  "/sessions",
  "/settings",
  "/switch",
];

/**
 * Metadata for a page a stranger should be able to find and share.
 *
 * metadataBase is set here rather than in the root layout because the layout
 * belongs to another track this batch; setting it per public page is the
 * documented alternative (it applies to the current segment and below) and it
 * keeps the private routes on Next's defaults, which is harmless for pages
 * nothing should link to.
 *
 * The OG image itself comes from the app/opengraph-image.tsx file convention,
 * which Next resolves against this base — so it is absolute, and it is the
 * same card for every public page.
 */
/**
 * The card image, named explicitly rather than inherited.
 *
 * This is not belt-and-braces; it is a fix. Next merges metadata shallowly,
 * so a page that declares `openGraph` at all REPLACES the parent's — and the
 * generated image from app/opengraph-image.tsx is attached to the root
 * segment's metadata. Every public page here declares openGraph (it needs its
 * own title and URL), so without this line /pricing, /sample-report, and the
 * legal pages shipped no og:image whatsoever. Verified by curling the built
 * server, not by reading the docs.
 *
 * The URL has no cache-busting hash, unlike the one Next generates for the
 * root; the route serves the same PNG either way.
 */
const OG_IMAGE = {
  url: new URL("/opengraph-image", SITE_URL).toString(),
  width: 1200,
  height: 630,
  alt: "flightcheck: would you pass the interview today?",
};

/**
 * Metadata for a page that should resolve its URLs correctly but stay out of
 * search results.
 *
 * Sign-in and transactional screens still get pasted into chats and still
 * inherit the root OG image, so they need the same base to resolve it
 * against — without it Next falls back to localhost and the card breaks. What
 * they do not need is to be indexed.
 */
export function privateMetadata(title: string): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title,
    robots: { index: false, follow: false },
    openGraph: { type: "website", siteName: SITE_NAME, title, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, images: [OG_IMAGE.url] },
  };
}

// --- Structured data (F-60) ----------------------------------------------
//
// Two schema.org nodes, built from the same modules the visible pages render
// from, so an engine that quotes the structured data quotes the page. They
// live here rather than inline in the pages because a JSON-LD object a test
// can import is a JSON-LD object a test can hold equal to the visible copy;
// inline in JSX it would be reachable only by rendering, and this suite has
// no DOM harness on purpose.
//
// Deliberately absent: aggregateRating and review. The product has no
// external reviews, so structured data claiming any would be an invention,
// and an invented rating is also a rich-results policy violation. The
// omission is pinned by tests/discoverability.test.ts.

/**
 * Serialize a JSON-LD node for a <script type="application/ld+json"> tag.
 *
 * JSON.stringify does not escape "<", so a "</script>" inside any string
 * would close the tag and start parsing markup: the XSS route the Next
 * JSON-LD guide warns about. Escaping every "<" to its unicode form is
 * invisible to JSON.parse and fatal to that route.
 */
export function jsonLdScript(node: Record<string, unknown>): string {
  return JSON.stringify(node).replace(/</g, "\\u003c");
}

/**
 * The offer on /pricing as schema.org Product+Offer: what is sold, described
 * in the landing page's own sentence, at the price lib/pricing.ts holds.
 */
export function productJsonLd(): Record<string, unknown> {
  const pricingUrl = new URL("/pricing", SITE_URL).toString();
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: SITE_NAME,
    description: HERO.body,
    image: OG_IMAGE.url,
    url: pricingUrl,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "Offer",
      price: PRICE_USD,
      priceCurrency: "USD",
      url: pricingUrl,
    },
  };
}

/**
 * The /faq page as schema.org FAQPage, mapped one-to-one from the FAQ data
 * module the visible accordion renders. Same source, so no drift is possible:
 * a reworded answer changes both surfaces in the same commit.
 */
export function faqPageJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

export function publicMetadata({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}): Metadata {
  const url = new URL(path, SITE_URL).toString();
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url,
      siteName: SITE_NAME,
      title,
      description,
      locale: "en_US",
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}
