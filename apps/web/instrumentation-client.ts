// Browser-side error monitoring (F-36).
//
// Next 16 runs this file before the app becomes interactive. It is the only
// place client failures are visible at all: a WebRTC negotiation that throws
// mid-interview, a recorder that dies on an unusual browser, a component
// that crashes into the error boundary. None of that reaches a server log.
//
// Same contract as the server half — no DSN, no SDK, no cost. The init is
// fire-and-forget because this file must never delay hydration, and a
// failure to set up monitoring must never take the page down with it.
//
// WHY THE VARIABLES ARE NAMED ONE BY ONE
//
// `process` does not exist in a browser. The bundler substitutes a literal
// value wherever it sees the member expression `process.env.NEXT_PUBLIC_X`,
// and falls back to the process/browser shim — whose `env` is `{}` — for any
// other use. So `sentryOptions(process.env)` reads an empty object here: it
// returns null on every browser, with a correct DSN configured, and with
// every unit test green, because the tests inject an env object the bundler
// never sees. Monitoring that silently reports nothing is worse than none,
// since it also stops anyone looking. Spelling each variable out is what
// makes the values real, and tests/instrumentation-client.test.ts is the
// gate that keeps them spelled out.
//
// Only NEXT_PUBLIC_* is readable here by design. The server-only SENTRY_DSN
// is deliberately absent: a browser bundle must not carry server config.

import { redactedEvent, sentryOptions } from "./lib/observability";

const options = sentryOptions({
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  NODE_ENV: process.env.NODE_ENV,
});

if (options !== null) {
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        ...options,
        beforeSend: redactedEvent,
        // No session replay: it records the DOM of a live interview room.
        replaysOnErrorSampleRate: 0,
        replaysSessionSampleRate: 0,
      });
    })
    .catch(() => {
      // Monitoring that cannot load is a missing feature, not an outage.
    });
}
