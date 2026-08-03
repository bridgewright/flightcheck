// Deploy-time environment validation (F-41).
//
// Every one of these variables is read at request time by a route that has
// no honest answer without it: lib/worker.ts throws "WORKER_URL is not set"
// inside a page render, the recordings route hands `undefined` to the
// Supabase client, the realtime mint sends "Bearer undefined" to OpenAI.
// The user sees a 500, or a checkout that "can't open right now", and the
// operator finds out from a customer.
//
// Checking the same list once, at build, turns all of that into a failed
// deploy — the previous build keeps serving, which is the correct outcome
// for a misconfigured release. next.config.ts calls assertRequiredEnv.
//
// Pure and env-injected so it is testable without touching process.env.

export const REQUIRED_SERVER_ENV = [
  // The scoring worker: every signed-in page fans out to it.
  "WORKER_URL",
  "WORKER_API_TOKEN",
  // The interview itself — the ephemeral secret is minted with this key.
  "OPENAI_API_KEY",
  // Recording upload URLs and the stored-size check (service role,
  // server-only; the NEXT_PUBLIC_* pair carries fallbacks and is not here).
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Payments. A deploy that cannot open checkout or verify a webhook is a
  // deploy that silently stops taking money, which is worse than a 500
  // because it looks deliberate.
  "POLAR_ACCESS_TOKEN",
  "POLAR_PRODUCT_ID",
  "POLAR_WEBHOOK_SECRET",
] as const;

export type RequiredServerEnv = (typeof REQUIRED_SERVER_ENV)[number];

type Env = Record<string, string | undefined>;

/**
 * Whether this process is a deploy that must be complete.
 *
 * Vercel sets VERCEL on every build it runs, production and preview alike —
 * that is exactly the set of builds whose output serves real users. A local
 * `npm run build` has no production secrets by design (they live in Vercel,
 * never in the repo), so failing it would only teach people to skip the
 * build. CI can opt in with FLIGHTCHECK_REQUIRE_ENV=1.
 */
export function shouldEnforceEnv(env: Env): boolean {
  return Boolean(env.VERCEL) || env.FLIGHTCHECK_REQUIRE_ENV === "1";
}

/** Names of the required variables that are absent or blank. */
export function missingRequiredEnv(env: Env): RequiredServerEnv[] {
  return REQUIRED_SERVER_ENV.filter((key) => (env[key] ?? "").trim() === "");
}

/**
 * Fail the build when a deploy is missing configuration.
 *
 * The message carries names only, never values: build logs are readable by
 * anyone with repository access, and this runs with every secret in scope.
 */
export function assertRequiredEnv(env: Env): void {
  if (!shouldEnforceEnv(env)) {
    return;
  }
  const missing = missingRequiredEnv(env);
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `Missing required environment ${missing.length === 1 ? "variable" : "variables"}: ` +
      `${missing.join(", ")}. ` +
      "Set them in the deployment environment and redeploy; the previous " +
      "build keeps serving until this one succeeds.",
  );
}
