import type { NextConfig } from "next";

import { assertRequiredEnv } from "./lib/env";
import { SENTRY_INGEST_ORIGINS } from "./lib/observability";
import { securityHeaderRules } from "./lib/security-headers";
import { SUPABASE_URL } from "./lib/supabase/config";

// F-41: fail the deploy, not the user. Every variable in REQUIRED_SERVER_ENV
// is read at request time by a route with no honest answer without it, so a
// missing one used to surface as a 500 (or a checkout that "can't open") on
// a live deployment. Checking here means a misconfigured release never
// promotes and the previous build keeps serving. Local builds are exempt by
// design — production secrets live in Vercel, never in the repo.
assertRequiredEnv(process.env);

const nextConfig: NextConfig = {
  experimental: {
    // authInterrupts enables forbidden(), which serves the S15 foreign-package page with a real HTTP 403.
    authInterrupts: true,
  },
  // F-12. The policy itself lives in lib/security-headers.ts, where it is
  // unit-tested against the paths a wrong policy would break: the OpenAI SDP
  // exchange, the Supabase auth and upload calls, Polar checkout, and the
  // microphone on the room page.
  headers: () =>
    Promise.resolve(
      securityHeaderRules({
        isDev: process.env.NODE_ENV === "development",
        supabaseOrigin: new URL(SUPABASE_URL).origin,
        sentryOrigins: SENTRY_INGEST_ORIGINS,
      }),
    ),
};

export default nextConfig;
