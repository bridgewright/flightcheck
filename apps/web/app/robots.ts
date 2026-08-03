import type { MetadataRoute } from "next";

import { DISALLOWED_PREFIXES, PUBLIC_ROUTES, SITE_URL } from "./site";

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

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: PUBLIC_ROUTES.map((route) => route.path),
      disallow: DISALLOWED_PREFIXES,
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
    host: SITE_URL,
  };
}
