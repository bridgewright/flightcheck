import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { DISALLOWED_PREFIXES, PUBLIC_ROUTES, SITE_URL, publicMetadata } from "@/app/site";

// F-40. The moment this exists for: a reviewer pastes a link into Slack and
// something unfurls. What must be true is small and checkable — the card is
// correct, the crawlable set is exactly the public pages, and the routes that
// carry a capability token or an account's work are not in it.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

describe("publicMetadata", () => {
  const meta = publicMetadata({
    path: "/pricing",
    title: "Pricing: flightcheck",
    description: "One package per job description.",
  });

  it("builds absolute URLs, not deployment-relative ones", () => {
    // A relative URL here resolves against Next's default base, which on
    // Vercel is the per-deployment hostname — a link nobody shares and a card
    // that points somewhere odd.
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/pricing`);
    expect(meta.openGraph?.url).toBe(`${SITE_URL}/pricing`);
    expect(meta.metadataBase?.toString()).toContain(SITE_URL);
  });

  it("carries the title and description into both card formats", () => {
    expect(meta.title).toBe("Pricing: flightcheck");
    expect(meta.openGraph?.title).toBe("Pricing: flightcheck");
    expect(meta.twitter?.title).toBe("Pricing: flightcheck");
    expect(meta.openGraph?.description).toBe("One package per job description.");
    expect(meta.twitter?.description).toBe("One package per job description.");
  });

  it("asks to be indexed — these are the pages that should be found", () => {
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("names the card image absolutely instead of inheriting it", () => {
    // Regression guard for a real defect: Next merges metadata shallowly, so
    // declaring openGraph on a page REPLACES the root's — and with it the
    // image the app/opengraph-image.tsx file convention attached there. Every
    // public page here declares openGraph, so /pricing, /sample-report, and
    // the legal pages shipped with no og:image at all until this was
    // explicit. Caught by curling the built server.
    const images = meta.openGraph?.images;
    expect(Array.isArray(images) && images.length).toBeTruthy();
    const first = (images as { url: string }[])[0];
    expect(first.url).toBe(`${SITE_URL}/opengraph-image`);
    const twitterImages = (meta.twitter as { images?: string[] } | undefined)?.images;
    expect(twitterImages?.[0]).toBe(`${SITE_URL}/opengraph-image`);
  });

  it("requests the large card, so a screenshot-shaped image is not cropped", () => {
    // Next's Twitter metadata type is a discriminated union; `card` is only
    // reachable after narrowing, hence the read through a structural type.
    const twitter = meta.twitter as { card?: string } | null | undefined;
    expect(twitter?.card).toBe("summary_large_image");
  });
});

describe("robots.txt", () => {
  const rules = robots();
  const single = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;

  it("points at an absolute sitemap URL", () => {
    expect(rules.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it("keeps every capability-token and account route out", () => {
    const disallow = [single?.disallow ?? []].flat();
    for (const prefix of DISALLOWED_PREFIXES) {
      expect(disallow).toContain(prefix);
    }
    // The sharp one, stated on its own: /p/<token> URLs ARE the capability.
    expect(disallow).toContain("/p/");
  });

  it("never disallows a route it also publishes in the sitemap", () => {
    const disallow = [single?.disallow ?? []].flat();
    for (const route of PUBLIC_ROUTES) {
      expect(disallow).not.toContain(route.path);
    }
  });

  it("allows the public pages explicitly", () => {
    const allow = [single?.allow ?? []].flat();
    for (const route of PUBLIC_ROUTES) {
      expect(allow).toContain(route.path);
    }
  });
});

describe("sitemap.xml", () => {
  const entries = sitemap();

  it("lists exactly the public routes, absolutely", () => {
    expect(entries.map((entry) => entry.url)).toEqual(
      PUBLIC_ROUTES.map((route) => `${SITE_URL}${route.path === "/" ? "/" : route.path}`),
    );
  });

  it("carries a last-modified date on every entry", () => {
    for (const entry of entries) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });

  it("leads with the landing page", () => {
    expect(entries[0].priority).toBe(1);
  });
});

describe("every public page ships a card", () => {
  const PAGE_FOR: Record<string, string> = {
    "/": "app/page.tsx",
    "/quick": "app/quick/page.tsx",
    "/pricing": "app/pricing/page.tsx",
    "/faq": "app/faq/page.tsx",
    "/sample-report": "app/sample-report/page.tsx",
    "/legal/terms": "app/legal/terms/page.tsx",
    "/legal/privacy": "app/legal/privacy/page.tsx",
    "/legal/refund": "app/legal/refund/page.tsx",
  };

  it("has a page mapped for every route in the sitemap", () => {
    expect(Object.keys(PAGE_FOR).sort()).toEqual(PUBLIC_ROUTES.map((r) => r.path).sort());
  });

  it.each(Object.entries(PAGE_FOR))(
    "%s builds its metadata from the shared helper",
    (_path, file) => {
      // One helper means one shape: canonical, OG, and Twitter cannot be
      // half-filled on a page someone forgot about.
      const source = read(file);
      expect(source).toContain("publicMetadata");
      expect(source).toContain("export const metadata");
    },
  );
});

describe("the OG image", () => {
  it("declares the card size social platforms expect", async () => {
    const image = await import("@/app/opengraph-image");
    expect(image.size).toEqual({ width: 1200, height: 630 });
    expect(image.contentType).toBe("image/png");
    expect(image.alt.length).toBeGreaterThan(20);
  });

  it("actually renders a PNG", async () => {
    // Asserting the exports is not the same claim as "the image renders".
    // satori refuses layouts it cannot handle (grid, a multi-child element
    // without an explicit display) at RENDER time, so the only honest proof
    // is to render it and look at the bytes.
    const { default: Image } = await import("@/app/opengraph-image");
    const response = Image();
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    // PNG magic number.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 30_000);
});
