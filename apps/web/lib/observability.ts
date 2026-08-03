// Error monitoring policy (F-36), separated from the SDK wiring so it can be
// unit-tested without importing @sentry/nextjs.
//
// Three decisions live here:
//   1. WHETHER to report at all — no DSN means a clean no-op, the same
//      contract the worker's init_sentry() has kept since v0.4. A deployment
//      turns monitoring on by setting one variable, not by shipping code.
//   2. WHAT the report says about itself — environment and release, so an
//      alert names a build instead of "production, some time this week".
//   3. WHAT must never leave the app. This product holds interview
//      recordings and transcripts, and its legacy links carry a capability
//      token IN THE URL (/p/<token>). An error report that quoted the URL
//      would hand a working credential to a third-party service, and put it
//      in an email alert. redactedEvent is the gate every event passes.

type Env = Record<string, string | undefined>;

/** Where the browser SDK POSTs events. The CSP's connect-src must list
 * these, or every client-side report is silently blocked — the one failure
 * mode error monitoring cannot report on itself. */
export const SENTRY_INGEST_ORIGINS = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
] as const;

export interface SentryOptions {
  dsn: string;
  environment: string;
  release: string | undefined;
  tracesSampleRate: number;
  sendDefaultPii: false;
}

function firstValue(env: Env, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = (env[key] ?? "").trim();
    if (value !== "") return value;
  }
  return undefined;
}

/**
 * Init options, or null when this deployment has no DSN.
 *
 * NEXT_PUBLIC_SENTRY_DSN is read first because it is the only form the
 * browser bundle can see; the server-only SENTRY_DSN is accepted too so the
 * worker and the web app can be configured the same way.
 */
export function sentryOptions(env: Env): SentryOptions | null {
  const dsn = firstValue(env, ["NEXT_PUBLIC_SENTRY_DSN", "SENTRY_DSN"]);
  if (dsn === undefined) {
    return null;
  }
  return {
    dsn,
    environment:
      firstValue(env, ["VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV", "NODE_ENV"]) ??
      "development",
    release: firstValue(env, [
      "VERCEL_GIT_COMMIT_SHA",
      "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
    ]),
    // Errors are the product need. Traces would multiply event volume,
    // add a second surface carrying URLs, and buy nothing this product
    // is currently asking. Explicitly 0 rather than absent.
    tracesSampleRate: 0,
    // Non-negotiable: IP addresses, cookies, and request bodies stay out.
    sendDefaultPii: false,
  };
}

// --- redaction --------------------------------------------------------------

const REDACTED = "[redacted]";

/** Query parameters that are credentials, not context. */
const SECRET_PARAMS = ["token", "access_token", "code"];

/**
 * A URL safe to put in an error report.
 *
 * Two things are stripped: the first segment after /p/, which IS the package
 * capability token, and any query parameter that carries a credential —
 * notably the Supabase auth `code`, a one-time grant for a whole session.
 *
 * Never throws, and never mangles: anything that is not an absolute URL or
 * an absolute path is returned untouched. Only the two shapes that can
 * actually carry one of our credentials are rewritten.
 */
export function redactedUrl(url: string): string {
  const absolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
  if (!absolute && !url.startsWith("/")) {
    return url;
  }
  try {
    // A dummy base makes path-only values parseable; it is stripped again
    // below, so the caller gets back the shape it passed in.
    const parsed = new URL(url, "https://redacted.invalid");
    parsed.pathname = parsed.pathname.replace(
      /^\/p\/[^/]+/,
      `/p/${REDACTED}`,
    );
    for (const key of SECRET_PARAMS) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return absolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/** The parts of a Sentry event this module touches. Structural on purpose:
 * the SDK's Event type is not imported, so these helpers stay testable
 * without the SDK and cannot drift into depending on its internals. */
export interface RedactableEvent {
  request?: { url?: string; query_string?: unknown };
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[];
}

/**
 * Scrub an event on its way out. Wired as Sentry's `beforeSend`, so it runs
 * on every event from every runtime, including ones the SDK generated on its
 * own.
 */
export function redactedEvent<T extends RedactableEvent>(event: T): T {
  if (event.request?.url !== undefined) {
    event.request.url = redactedUrl(event.request.url);
  }
  if (event.request !== undefined && "query_string" in event.request) {
    // The URL above already carries the (redacted) query. A second raw copy
    // is only a second way to leak it.
    delete event.request.query_string;
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.data === undefined) continue;
    for (const [key, value] of Object.entries(crumb.data)) {
      if (typeof value === "string" && value.includes("/p/")) {
        crumb.data[key] = redactedUrl(value);
      }
    }
  }
  return event;
}
