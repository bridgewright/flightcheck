// The response security headers (F-12), as a pure function so the policy can
// be tested against the four paths a wrong policy would break.
//
// Consumed by next.config.ts headers(), NOT by proxy.ts. Two reasons:
// the proxy's matcher is an include-list of signed-in surfaces, so it never
// sees the landing page or the legal pages; and next.config headers apply to
// prerendered responses too, which a proxy-only policy would miss.
//
// WHY NO NONCE
//
// The strict form of this policy is `script-src 'self' 'nonce-…'
// 'strict-dynamic'`, generated per request in the proxy. Next.js supports it,
// and it is the only way to drop 'unsafe-inline' — Next inlines the RSC flight
// payload as <script>self.__next_f.push(...)</script> on every page, and those
// scripts are per-render, so no fixed hash can cover them.
//
// It was rejected for this release. A nonce is injected during server
// rendering, so EVERY page must be dynamically rendered; a page that Next
// prerenders ships without the nonce, is then served with a CSP demanding
// one, and renders as a blank screen. This app still prerenders /login and
// /new, and the landing page is being rebuilt in parallel. A CSP that blanks
// the sign-in page is far worse than one that permits inline script — the
// same reasoning that says a CSP which breaks payment is worse than no CSP.
//
// So 'unsafe-inline' on script-src is a KNOWN WEAKNESS, stated rather than
// hidden: it means this policy is not an XSS containment boundary. What it
// does buy is real and is the reason it ships:
//   * connect-src is an exfiltration allowlist — injected script cannot post
//     a transcript to an attacker's host.
//   * frame-ancestors / X-Frame-Options stop clickjacking outright.
//   * object-src 'none' and base-uri 'self' remove two classic escalation
//     primitives.
//   * form-action bounds where credentials can be posted.
// Revisit when every route is dynamic, or when Next emits a stable hash for
// its bootstrap inline script.

export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export interface SecurityHeaderOptions {
  isDev: boolean;
  /** Origin of the Supabase project (auth + signed storage uploads). */
  supabaseOrigin: string;
  /** Where the browser error reporter posts. */
  sentryOrigins: readonly string[];
}

/** The interview room — the one page allowed to ask for a microphone. */
export const ROOM_PATH_SOURCE = "/sessions/:id/room";

/** The legacy share links, which carry a capability token in the path. */
export const TOKEN_LINK_SOURCE = "/p/:path*";

/** Polar's hosted checkout. Named in form-action defensively: the redirect
 * to it is a GET navigation, which CSP does not govern, but a future
 * form-driven checkout must not become a payment outage discovered in
 * production. */
export const POLAR_FORM_ACTION_ORIGINS = [
  "https://polar.sh",
  "https://*.polar.sh",
] as const;

/** OpenAI Realtime: the browser POSTs its WebRTC offer here directly. */
const OPENAI_ORIGIN = "https://api.openai.com";

export function contentSecurityPolicy(options: SecurityHeaderOptions): string {
  const { isDev, supabaseOrigin, sentryOrigins } = options;
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    // See the note above: 'unsafe-inline' is required by Next's inline RSC
    // payload. 'unsafe-eval' is React's dev-only error reconstruction.
    ["script-src", ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])]],
    // Next inlines critical CSS, and three things in the product set a style
    // attribute directly. Two are computed dimensions: the mic meter's level
    // and the report's score bars. The third is the whole landing page: the
    // motion layer renders each animated block's `initial` state as an inline
    // `opacity`/`transform`, so every `data-reveal` element ships one.
    //
    // Written out because the count is the thing a future tightening will
    // check. Anyone reading "two small components" and moving style-src to
    // hashes would blank the landing page, since those inline styles are
    // generated per render and cannot be hashed ahead of time.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    // next/font self-hosts at build; nothing is fetched from a font CDN.
    ["font-src", ["'self'"]],
    [
      "connect-src",
      [
        "'self'",
        supabaseOrigin,
        OPENAI_ORIGIN,
        ...sentryOrigins,
        // The dev server's HMR socket, and nothing in production.
        ...(isDev ? ["ws:", "wss:"] : []),
      ],
    ],
    // The interviewer's audio arrives as a MediaStream on srcObject, which
    // no URL directive governs; blob: covers anything the recorder hands to
    // an element.
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", ...POLAR_FORM_ACTION_ORIGINS]],
    // This app embeds nothing and must never be embedded: the room asks for
    // a microphone, and a report is a private document.
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["upgrade-insecure-requests", []],
  ];
  return directives
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

/**
 * Permissions-Policy. Only features worth denying are named; anything absent
 * keeps its browser default.
 *
 * `microphone` is the whole reason this is per-path: denying it globally is
 * the correct posture for a product that asks for a microphone on exactly
 * one page, and permitting it on that page is not optional — without it the
 * interview cannot start.
 */
export function permissionsPolicy({
  microphone,
}: {
  microphone: boolean;
}): string {
  return [
    "accelerometer=()",
    // The room autoplays the interviewer's voice into an <audio> element.
    "autoplay=(self)",
    "camera=()",
    "display-capture=()",
    "encrypted-media=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    `microphone=(${microphone ? "self" : ""})`,
    "midi=()",
    "payment=()",
    "usb=()",
  ].join(", ");
}

/**
 * The rules for next.config.ts `headers()`.
 *
 * Order matters: Next applies every matching rule and the LAST value for a
 * key wins, so the room's microphone override is last.
 */
export function securityHeaderRules(
  options: SecurityHeaderOptions,
): HeaderRule[] {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
        // allow-popups deliberately: a popup-based OAuth sign-in must keep
        // working. Full isolation would be same-origin.
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        { key: "Permissions-Policy", value: permissionsPolicy({ microphone: false }) },
      ],
    },
    {
      // A capability token in the path must not travel in a Referer header.
      source: TOKEN_LINK_SOURCE,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        // robots.txt disallows /p/ too, but the two do different jobs and
        // neither is sufficient alone: a disallowed URL can still be indexed
        // URL-only from an inbound link, and a crawler obeying the disallow
        // never fetches the page, so it never sees a meta noindex. A header
        // is the one signal that survives being fetched by a crawler that
        // ignored robots.txt.
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    },
    {
      source: ROOM_PATH_SOURCE,
      headers: [
        { key: "Permissions-Policy", value: permissionsPolicy({ microphone: true }) },
      ],
    },
  ];
}
