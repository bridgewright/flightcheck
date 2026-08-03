// Server- and edge-side error monitoring (F-36).
//
// Next 16 calls register() once per server instance before the first request
// is served, and onRequestError for every error the server catches — a
// server component that threw, a route handler that threw, a Server Action
// that threw. Before this file those errors existed only as a line in a
// Vercel function log that nobody was watching.
//
// Everything here is a no-op without a DSN: sentryOptions returns null and
// the SDK is never imported. That keeps monitoring a deployment setting
// rather than a code change, and mirrors the worker's init_sentry().
//
// The dynamic import is deliberate. A top-level `import * as Sentry` would
// pull the SDK into every server bundle whether or not the deployment uses
// it; importing inside the guard keeps an unconfigured deployment exactly as
// it was.

import { redactedEvent, sentryOptions } from "./lib/observability";

export async function register() {
  const options = sentryOptions(process.env);
  if (options === null) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    ...options,
    // Every event, from every runtime, passes the same redaction: this
    // product's legacy links carry a capability token in the URL, and an
    // error report must never hand one to a third party.
    beforeSend: redactedEvent,
  });
}

export async function onRequestError(
  ...args: Parameters<
    NonNullable<typeof import("@sentry/nextjs")["captureRequestError"]>
  >
) {
  if (sentryOptions(process.env) === null) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
