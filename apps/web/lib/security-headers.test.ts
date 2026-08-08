import { describe, expect, it } from "vitest";

import { SENTRY_INGEST_ORIGINS } from "./observability";
import {
  POLAR_FORM_ACTION_ORIGINS,
  contentSecurityPolicy,
  permissionsPolicy,
  securityHeaderRules,
} from "./security-headers";

const SUPABASE = "https://project.supabase.co";

const options = {
  isDev: false,
  supabaseOrigin: SUPABASE,
  sentryOrigins: SENTRY_INGEST_ORIGINS,
};

/** The directives of a policy string, as name -> source list. */
function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources];
      }),
  );
}

function headerValue(source: string, key: string): string | undefined {
  const rules = securityHeaderRules(options);
  // Next applies every matching rule in order and the last value for a key
  // wins, so read them the same way.
  let value: string | undefined;
  for (const rule of rules) {
    if (rule.source !== source) continue;
    for (const header of rule.headers) {
      if (header.key.toLowerCase() === key.toLowerCase()) value = header.value;
    }
  }
  return value;
}

describe("contentSecurityPolicy", () => {
  const csp = directives(contentSecurityPolicy(options));

  it("defaults to self", () => {
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("refuses to be framed, twice over", () => {
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(headerValue("/(.*)", "X-Frame-Options")).toBe("DENY");
  });

  it("kills the classic injection primitives", () => {
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["frame-src"]).toEqual(["'none'"]);
  });

  // --- the four things a wrong CSP would break ---------------------------

  it("(d) lets the interview room reach OpenAI for the SDP exchange", () => {
    // SessionRoom POSTs the WebRTC offer to api.openai.com from the browser.
    // Without this the room cannot connect at all.
    expect(csp["connect-src"]).toContain("https://api.openai.com");
  });

  it("(c) lets the browser talk to Supabase for auth and the upload", () => {
    // Two client paths: createBrowserClient (sign-in, session refresh) and
    // the PUT of the recording to a signed storage URL.
    expect(csp["connect-src"]).toContain(SUPABASE);
  });

  it("(a) allows a form post to Polar, so hosted checkout cannot be blocked", () => {
    // The hosted-checkout hop is a server redirect on a GET navigation, which
    // no CSP directive governs. form-action still names Polar: it costs
    // nothing against a merchant we already trust with the payment, and it
    // removes the entire class of "the CSP broke checkout".
    for (const origin of POLAR_FORM_ACTION_ORIGINS) {
      expect(csp["form-action"]).toContain(origin);
    }
    expect(csp["form-action"]).toContain("'self'"); // server actions
  });

  it("lets client error reports reach Sentry", () => {
    for (const origin of SENTRY_INGEST_ORIGINS) {
      expect(csp["connect-src"]).toContain(origin);
    }
  });

  it("allows the assets this app actually serves", () => {
    expect(csp["img-src"]).toContain("'self'");
    expect(csp["img-src"]).toContain("data:");
    expect(csp["img-src"]).toContain("blob:");
    expect(csp["font-src"]).toEqual(["'self'"]); // next/font self-hosts
    expect(csp["media-src"]).toContain("blob:");
    expect(csp["media-src"]).toContain(SUPABASE);
  });

  it("derives media-src from the argument origin, never a second literal", () => {
    // Two different origins: a hardcoded hostname would track neither.
    for (const origin of ["https://a.example", "https://b.example"]) {
      const built = directives(
        contentSecurityPolicy({ ...options, supabaseOrigin: origin }),
      );
      expect(built["media-src"]).toContain(origin);
      expect(built["connect-src"]).toContain(origin);
    }
  });

  it("upgrades insecure requests", () => {
    expect(csp["upgrade-insecure-requests"]).toEqual([]);
  });

  // --- what is deliberately still permitted ------------------------------

  it("permits inline script, because Next inlines its RSC payload", () => {
    // Documented weakness, not an oversight: a nonce would force every page
    // dynamic. See docs/architecture.md.
    expect(csp["script-src"]).toContain("'self'");
    expect(csp["script-src"]).toContain("'unsafe-inline'");
  });

  it("permits eval only in development, where React needs it", () => {
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    const dev = directives(contentSecurityPolicy({ ...options, isDev: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
  });

  it("allows the dev server's own websocket only in development", () => {
    const dev = directives(contentSecurityPolicy({ ...options, isDev: true }));
    expect(dev["connect-src"]).toContain("ws:");
    expect(csp["connect-src"]).not.toContain("ws:");
  });

  it("is one line, with no stray whitespace or newlines", () => {
    const policy = contentSecurityPolicy(options);
    expect(policy).not.toMatch(/\n/);
    expect(policy).not.toMatch(/\s{2,}/);
    expect(policy.endsWith(";")).toBe(false);
  });
});

describe("permissionsPolicy", () => {
  it("grants the microphone to this origin only, everywhere", () => {
    // Global self on purpose: Permissions-Policy binds to the DOCUMENT,
    // and a client-side route transition never fetches a new one — a
    // room-path grant only held on hard loads, so entering the room
    // through the app's own navigation inherited the entry route's
    // microphone=() and getUserMedia refused as if the customer had
    // blocked the site (2026-08-08: first entry failed, refresh worked).
    expect(permissionsPolicy()).toContain("microphone=(self)");
    expect(permissionsPolicy()).not.toContain("microphone=()");
  });

  it("denies the camera everywhere: this product never records video", () => {
    expect(permissionsPolicy()).toContain("camera=()");
  });

  it("keeps autoplay for self, or the interviewer's voice never plays", () => {
    expect(permissionsPolicy()).toContain("autoplay=(self)");
  });
});

describe("securityHeaderRules", () => {
  it("applies the policy to every path", () => {
    expect(securityHeaderRules(options)[0].source).toBe("/(.*)");
    expect(headerValue("/(.*)", "Content-Security-Policy")).toBe(
      contentSecurityPolicy(options),
    );
  });

  it("(d) grants the microphone globally — no per-path override remains", () => {
    expect(headerValue("/(.*)", "Permissions-Policy")).toContain(
      "microphone=(self)",
    );
    // The per-path room override is GONE on purpose: under client-side
    // navigation it never governed the document that actually asked for
    // the microphone. No rule may reintroduce a path-scoped
    // Permissions-Policy while this app is an SPA.
    const rules = securityHeaderRules(options);
    for (const rule of rules) {
      if (rule.source === "/(.*)") continue;
      expect(
        rule.headers.some((h) => h.key === "Permissions-Policy"),
      ).toBe(false);
    }
  });

  it("sends no referrer at all from the token-bearing share links", () => {
    // /p/<token> puts a working capability in the URL. A referrer would
    // hand it to every third party the page touches.
    expect(headerValue("/p/:path*", "Referrer-Policy")).toBe("no-referrer");
    expect(headerValue("/(.*)", "Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("tells crawlers not to index the token-bearing share links", () => {
    // robots.txt disallows /p/ as well, and the two are not redundant: a
    // disallowed URL can still be indexed URL-only from an inbound link, and
    // a crawler that obeys the disallow never fetches the page, so it never
    // sees a meta noindex. The header is the signal that survives a fetch by
    // a crawler that ignored robots.txt.
    expect(headerValue("/p/:path*", "X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect(headerValue("/(.*)", "X-Robots-Tag")).toBeUndefined();
  });

  it("sets the rest of the baseline once", () => {
    expect(headerValue("/(.*)", "X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue("/(.*)", "Strict-Transport-Security")).toContain(
      "max-age=",
    );
    // allow-popups, not same-origin: an OAuth sign-in that opens a popup
    // must keep working (F-44 adds Google sign-in in this batch).
    expect(headerValue("/(.*)", "Cross-Origin-Opener-Policy")).toBe(
      "same-origin-allow-popups",
    );
  });

  it("(b) adds response headers only — nothing that could touch a request body", () => {
    // The Polar webhook verifies a signature over the RAW body. Every rule
    // here is a response header; none rewrites, redirects, or reads a body.
    for (const rule of securityHeaderRules(options)) {
      expect(Object.keys(rule).sort()).toEqual(["headers", "source"]);
      for (const header of rule.headers) {
        expect(typeof header.key).toBe("string");
        expect(typeof header.value).toBe("string");
      }
    }
  });

  it("carries no header value with a newline, which would split the response", () => {
    for (const rule of securityHeaderRules(options)) {
      for (const header of rule.headers) {
        expect(header.value).not.toMatch(/[\r\n]/);
      }
    }
  });
});
