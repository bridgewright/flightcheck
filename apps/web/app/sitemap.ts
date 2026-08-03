import type { MetadataRoute } from "next";

import { PUBLIC_ROUTES, SITE_URL } from "./site";

// The sitemap is exactly PUBLIC_ROUTES, resolved to absolute URLs. There is
// no dynamic content to enumerate — every other route in this app belongs to
// one account or carries a capability token, and neither has any business in
// a search index (see DISALLOWED_PREFIXES in ./site.ts).
//
// lastModified is the build time rather than a per-page date. That is the
// honest answer for a site whose pages change when it is deployed, and it
// avoids inventing a date per route that nothing actually tracks.

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: new URL(route.path, SITE_URL).toString(),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
