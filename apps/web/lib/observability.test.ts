import { describe, expect, it } from "vitest";

import {
  SENTRY_INGEST_ORIGINS,
  redactedEvent,
  redactedUrl,
  sentryOptions,
} from "./observability";

describe("sentryOptions", () => {
  it("is null without a DSN, so an unconfigured deployment is a clean no-op", () => {
    expect(sentryOptions({})).toBeNull();
    expect(sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "" })).toBeNull();
    expect(sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "   " })).toBeNull();
  });

  it("reads the public DSN first, then the server-only one", () => {
    expect(sentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "https://a@b/1" })?.dsn).toBe(
      "https://a@b/1",
    );
    expect(sentryOptions({ SENTRY_DSN: "https://c@d/2" })?.dsn).toBe(
      "https://c@d/2",
    );
  });

  it("never sends PII: this app holds interview transcripts", () => {
    expect(sentryOptions({ SENTRY_DSN: "https://a@b/1" })?.sendDefaultPii).toBe(
      false,
    );
  });

  it("keeps tracing off — errors are the product need, traces are quota", () => {
    expect(
      sentryOptions({ SENTRY_DSN: "https://a@b/1" })?.tracesSampleRate,
    ).toBe(0);
  });

  it("labels the environment so preview noise is separable from production", () => {
    expect(
      sentryOptions({ SENTRY_DSN: "https://a@b/1", VERCEL_ENV: "preview" })
        ?.environment,
    ).toBe("preview");
    expect(
      sentryOptions({
        SENTRY_DSN: "https://a@b/1",
        NEXT_PUBLIC_VERCEL_ENV: "production",
      })?.environment,
    ).toBe("production");
    expect(sentryOptions({ SENTRY_DSN: "https://a@b/1" })?.environment).toBe(
      "development",
    );
  });

  it("carries the commit as the release, so an alert names a build", () => {
    expect(
      sentryOptions({
        SENTRY_DSN: "https://a@b/1",
        VERCEL_GIT_COMMIT_SHA: "abc123",
      })?.release,
    ).toBe("abc123");
    expect(sentryOptions({ SENTRY_DSN: "https://a@b/1" })?.release).toBe(
      undefined,
    );
  });
});

describe("redactedUrl", () => {
  it("strips the capability token out of a /p/<token> path", () => {
    expect(redactedUrl("https://app.example/p/tok-abc123")).toBe(
      "https://app.example/p/[redacted]",
    );
    expect(redactedUrl("https://app.example/p/tok-abc123/report/s-1")).toBe(
      "https://app.example/p/[redacted]/report/s-1",
    );
    expect(redactedUrl("https://app.example/p/tok-abc123/session/s-1")).toBe(
      "https://app.example/p/[redacted]/session/s-1",
    );
  });

  it("strips the Supabase auth code, which is a one-time session grant", () => {
    expect(
      redactedUrl("https://app.example/auth/callback?code=pkce-secret&next=/home"),
    ).toBe("https://app.example/auth/callback?code=%5Bredacted%5D&next=%2Fhome");
  });

  it("strips token-bearing query parameters whatever the path", () => {
    const scrubbed = redactedUrl(
      "https://app.example/anything?token=t&access_token=a&keep=1",
    );
    expect(scrubbed).toContain("keep=1");
    expect(scrubbed).not.toContain("token=t");
    expect(scrubbed).not.toContain("access_token=a");
  });

  it("leaves an ordinary URL alone", () => {
    expect(redactedUrl("https://app.example/sessions/abc?pkg=1")).toBe(
      "https://app.example/sessions/abc?pkg=1",
    );
  });

  it("handles a path-only URL and never throws on garbage", () => {
    expect(redactedUrl("/p/tok-1/report/s-1")).toBe("/p/[redacted]/report/s-1");
    expect(redactedUrl("")).toBe("");
    expect(redactedUrl("not a url at all")).toBe("not a url at all");
  });
});

describe("redactedEvent", () => {
  it("redacts the request url an error was reported from", () => {
    const event = redactedEvent({
      request: { url: "https://app.example/p/tok-abc/report/s-1" },
    });
    expect(event.request?.url).toBe("https://app.example/p/[redacted]/report/s-1");
  });

  it("drops the raw query string rather than trying to parse it twice", () => {
    const event = redactedEvent({
      request: { url: "https://app.example/x", query_string: "token=secret" },
    });
    expect(event.request?.query_string).toBeUndefined();
  });

  it("redacts breadcrumb urls, which carry navigation history", () => {
    const event = redactedEvent({
      breadcrumbs: [
        { data: { url: "/p/tok-abc" } },
        { data: { from: "/p/tok-abc", to: "/home" } },
        { message: "no data at all" },
      ],
    });
    expect(event.breadcrumbs?.[0].data?.url).toBe("/p/[redacted]");
    expect(event.breadcrumbs?.[1].data?.from).toBe("/p/[redacted]");
    expect(event.breadcrumbs?.[1].data?.to).toBe("/home");
    expect(event.breadcrumbs?.[2].message).toBe("no data at all");
  });

  it("passes an event with nothing sensitive through untouched", () => {
    const event = { request: { url: "https://app.example/home" } };
    expect(redactedEvent(event)).toEqual(event);
  });
});

describe("SENTRY_INGEST_ORIGINS", () => {
  it("names the hosts the browser SDK posts to, for the CSP to allow", () => {
    // A strict connect-src that forgets these silently drops every client
    // error report — the exact failure error monitoring cannot detect.
    expect(SENTRY_INGEST_ORIGINS.length).toBeGreaterThan(0);
    for (const origin of SENTRY_INGEST_ORIGINS) {
      expect(origin.startsWith("https://")).toBe(true);
      expect(origin).toContain("sentry.io");
    }
  });
});
