import { describe, expect, it } from "vitest";

import {
  REQUIRED_SERVER_ENV,
  assertRequiredEnv,
  missingRequiredEnv,
  shouldEnforceEnv,
} from "./env";

/** A fully configured deployment. */
function complete(): Record<string, string> {
  return Object.fromEntries(REQUIRED_SERVER_ENV.map((key) => [key, "set"]));
}

describe("REQUIRED_SERVER_ENV", () => {
  it("covers every secret a running deployment cannot serve without", () => {
    expect(REQUIRED_SERVER_ENV).toContain("WORKER_URL");
    expect(REQUIRED_SERVER_ENV).toContain("WORKER_API_TOKEN");
    expect(REQUIRED_SERVER_ENV).toContain("OPENAI_API_KEY");
    expect(REQUIRED_SERVER_ENV).toContain("SUPABASE_URL");
    expect(REQUIRED_SERVER_ENV).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(REQUIRED_SERVER_ENV).toContain("POLAR_ACCESS_TOKEN");
    expect(REQUIRED_SERVER_ENV).toContain("POLAR_PRODUCT_ID");
    expect(REQUIRED_SERVER_ENV).toContain("POLAR_WEBHOOK_SECRET");
  });

  it("does not require the public Supabase values, which carry fallbacks", () => {
    expect(REQUIRED_SERVER_ENV).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(REQUIRED_SERVER_ENV).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });
});

describe("missingRequiredEnv", () => {
  it("is empty for a fully configured deployment", () => {
    expect(missingRequiredEnv(complete())).toEqual([]);
  });

  it("names every absent variable, not just the first", () => {
    const env = complete();
    delete env.WORKER_URL;
    delete env.POLAR_WEBHOOK_SECRET;
    expect(missingRequiredEnv(env)).toEqual([
      "WORKER_URL",
      "POLAR_WEBHOOK_SECRET",
    ]);
  });

  it("treats an empty or whitespace value as missing", () => {
    // Vercel keeps a variable that was cleared in the UI as "". A blank
    // token fails at request time exactly like an absent one.
    expect(missingRequiredEnv({ ...complete(), WORKER_API_TOKEN: "" })).toEqual([
      "WORKER_API_TOKEN",
    ]);
    expect(missingRequiredEnv({ ...complete(), WORKER_API_TOKEN: "  " })).toEqual([
      "WORKER_API_TOKEN",
    ]);
  });
});

describe("shouldEnforceEnv", () => {
  it("enforces on a Vercel build — the deploy this protects", () => {
    expect(shouldEnforceEnv({ VERCEL: "1" })).toBe(true);
  });

  it("enforces when a CI job asks for it explicitly", () => {
    expect(shouldEnforceEnv({ FLIGHTCHECK_REQUIRE_ENV: "1" })).toBe(true);
  });

  it("skips a local build, which has no production secrets by design", () => {
    expect(shouldEnforceEnv({})).toBe(false);
    expect(shouldEnforceEnv({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("assertRequiredEnv", () => {
  it("fails the build with every missing name in one message", () => {
    const env: Record<string, string | undefined> = {
      ...complete(),
      VERCEL: "1",
    };
    delete env.OPENAI_API_KEY;
    delete env.SUPABASE_URL;
    expect(() => assertRequiredEnv(env)).toThrow(/OPENAI_API_KEY/);
    expect(() => assertRequiredEnv(env)).toThrow(/SUPABASE_URL/);
  });

  it("never puts a value in the message, only the name", () => {
    const env = { ...complete(), VERCEL: "1", WORKER_API_TOKEN: "" };
    let message = "";
    try {
      assertRequiredEnv(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("WORKER_API_TOKEN");
    expect(message).not.toContain("set"); // the placeholder value above
  });

  it("passes a fully configured deployment", () => {
    expect(() => assertRequiredEnv({ ...complete(), VERCEL: "1" })).not.toThrow();
  });

  it("passes a local build even with nothing set", () => {
    expect(() => assertRequiredEnv({})).not.toThrow();
  });
});
