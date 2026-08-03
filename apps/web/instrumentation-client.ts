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

import { redactedEvent, sentryOptions } from "./lib/observability";

const options = sentryOptions(process.env);

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
