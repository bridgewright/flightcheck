import { describe, expect, it } from "vitest";

import { SENTRY_INGEST_ORIGINS } from "./observability";
import {
  POLAR_FORM_ACTION_ORIGINS,
  ROOM_PATH_SOURCE,
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
  it("denies the microphone by default", () => {
    expect(permissionsPolicy({ microphone: false })).toContain("microphone=()");
  });

  it("permits the microphone where the interview happens", () => {
    expect(permissionsPolicy({ microphone: true })).toContain(
      "microphone=(self)",
    );
  });

  it("denies the camera everywhere: this product never records video", () => {
    expect(permissionsPolicy({ microphone: true })).toContain("camera=()");
    expect(permissionsPolicy({ microphone: false })).toContain("camera=()");
  });

  it("keeps autoplay for self, or the interviewer's voice never plays", () => {
    expect(permissionsPolicy({ microphone: true })).toContain("autoplay=(self)");
  });
});

describe("securityHeaderRules", () => {
  it("applies the policy to every path", () => {
    expect(securityHeaderRules(options)[0].source).toBe("/(.*)");
    expect(headerValue("/(.*)", "Content-Security-Policy")).toBe(
      contentSecurityPolicy(options),
    );
  });

  it("(d) overrides the microphone denial on the room path only", () => {
    expect(headerValue("/(.*)", "Permissions-Policy")).toContain("microphone=()");
    expect(headerValue(ROOM_PATH_SOURCE, "Permissions-Policy")).toContain(
      "microphone=(self)",
    );
    // Next applies matching rules in order and the last wins, so the room
    // rule must come after the global one.
    const rules = securityHeaderRules(options);
    expect(rules.findIndex((rule) => rule.source === ROOM_PATH_SOURCE)).toBe(
      rules.length - 1,
    );
  });

  it("sends no referrer at all from the token-bearing share links", () => {
    // /p/<token> puts a working capability in the URL. A referrer would
    // hand it to every third party the page touches.
    expect(headerValue("/p/:path*", "Referrer-Policy")).toBe("no-referrer");
    expect(headerValue("/(.*)", "Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
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
