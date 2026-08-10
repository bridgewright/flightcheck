import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPackagesForUser, redeemCbtCode, WorkerError } from "@/lib/worker";

const calls: Array<{ url: string; init?: RequestInit }> = [];
let response: Response;

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv("WORKER_URL", "https://worker.example.test");
  vi.stubEnv("WORKER_API_TOKEN", "worker-token");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CBT worker client", () => {
  it("posts the frozen worker path where the worker mounts it: under /api", async () => {
    // PLAYBOOK 4.5b: the brief's contract writes paths relative to the
    // worker's /api prefix (scorer routers/__init__.py: "paths RELATIVE to
    // /api"). /cbt/redeem unprefixed answers 404 in production — the exact
    // defect /packages/quick shipped with once.
    response = Response.json({ label: "Beta", packages_remaining: 3, package_expires_at: "2026-08-31T00:00:00Z" });
    await redeemCbtCode("user-1", "BETA");
    expect(calls[0].url).toBe("https://worker.example.test/api/cbt/redeem");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ user_id: "user-1", code: "BETA" });
  });

  it("preserves typed refusal status and code", async () => {
    response = Response.json({ code: "cbt-closed" }, { status: 410 });
    const error = await redeemCbtCode("user-1", "BETA").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkerError);
    expect(error).toMatchObject({ status: 410, code: "cbt-closed" });
  });

  it("surfaces the top-level CBT entitlement with the package list", async () => {
    const cbt = { label: "Beta", packages_granted: 1, packages_remaining: 2, package_expires_at: "2026-08-31T00:00:00Z" };
    response = Response.json({ packages: [], cbt });
    expect(await getPackagesForUser("user-1")).toEqual({ packages: [], cbt });
  });
});
