import type { NextConfig } from "next";

import { assertRequiredEnv } from "./lib/env";

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
};

export default nextConfig;
