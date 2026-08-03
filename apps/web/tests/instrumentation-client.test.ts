import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sentryOptions } from "@/lib/observability";

// F-36: the browser half of error monitoring must actually be able to see a
// DSN.
//
// The failure this gate exists for is silent and total. `process` does not
// exist in a browser; the bundler substitutes a literal only where it sees
// the member expression `process.env.NEXT_PUBLIC_X`, and everything else
// resolves to the process/browser shim whose `env` is `{}`. So
// `sentryOptions(process.env)` in instrumentation-client.ts compiled, passed
// every unit test (they inject an env object the bundler never sees), built
// clean — and returned null in every browser, with a correct DSN set. The
// one failure mode error monitoring cannot report is its own absence.
//
// There is no browser here to assert against, so this reads the source: the
// client entry must name each variable, and must never hand the whole
// `process.env` object to sentryOptions again.

const CLIENT_ENTRY = fileURLToPath(
  new URL("../instrumentation-client.ts", import.meta.url),
);
const source = readFileSync(CLIENT_ENTRY, "utf8");

/** The source with comments stripped, so prose about the trap is not
 * mistaken for the trap. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

describe("instrumentation-client env reads", () => {
  it("never passes the whole process.env object, which is empty in a browser", () => {
    // Any `process.env` not immediately followed by `.NAME` is the bug.
    expect(code).not.toMatch(/process\.env(?!\s*\.\s*[A-Za-z_])/);
  });

  it("reads the DSN as a literal member expression, so it is inlined", () => {
    // This is the variable that decides whether monitoring exists at all.
    expect(code).toContain("process.env.NEXT_PUBLIC_SENTRY_DSN");
  });

  it("reads the environment and release the same way", () => {
    // Without these an alert says "some build, some environment" — which is
    // the state the incident that motivated F-36 was diagnosed in.
    expect(code).toContain("process.env.NODE_ENV");
    expect(code).toContain("process.env.NEXT_PUBLIC_VERCEL_ENV");
    expect(code).toContain("process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA");
  });

  it("carries no server-only variable into the browser bundle", () => {
    // SENTRY_DSN, VERCEL_ENV and VERCEL_GIT_COMMIT_SHA are server config.
    // They would not inline here anyway; naming them would only imply a
    // browser can read server env.
    expect(code).not.toMatch(/process\.env\.SENTRY_DSN/);
    expect(code).not.toMatch(/process\.env\.VERCEL_/);
  });

  it("the keys it passes are the keys sentryOptions actually consults", () => {
    // A drift gate in the other direction: if this list and lib/observability
    // ever disagree, the browser silently loses whichever field moved.
    const options = sentryOptions({
      NEXT_PUBLIC_SENTRY_DSN: "https://a@b/1",
      NEXT_PUBLIC_VERCEL_ENV: "production",
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: "abc123",
      NODE_ENV: "production",
    });
    expect(options).not.toBeNull();
    expect(options?.dsn).toBe("https://a@b/1");
    expect(options?.environment).toBe("production");
    expect(options?.release).toBe("abc123");
  });
});
