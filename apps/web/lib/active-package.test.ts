import { describe, expect, it } from "vitest";

import type { PackageSummary } from "@/lib/worker";
import { resolveActivePackage } from "@/lib/active-package";

function pkg(id: string, overrides: Partial<PackageSummary> = {}): PackageSummary {
  return {
    id,
    access_token: `tok-${id}`,
    status: "ready",
    user_id: "user-1",
    total_sessions: 6,
    sessions_used: 0,
    role_title: null,
    ...overrides,
  };
}

// The worker lists a user's packages newest-first (created_at desc), so
// "newest owned" is simply the head of the list.
const owned = [pkg("pkg-new"), pkg("pkg-mid"), pkg("pkg-old")];

describe("resolveActivePackage", () => {
  it("prefers the ?pkg= query parameter over everything", () => {
    expect(resolveActivePackage(owned, "pkg-old", "pkg-mid")?.id).toBe("pkg-old");
  });

  it("falls back to the cookie when there is no query parameter", () => {
    expect(resolveActivePackage(owned, null, "pkg-mid")?.id).toBe("pkg-mid");
    expect(resolveActivePackage(owned, undefined, "pkg-mid")?.id).toBe("pkg-mid");
  });

  it("falls back to the newest package when neither hint is present", () => {
    expect(resolveActivePackage(owned, null, null)?.id).toBe("pkg-new");
    expect(resolveActivePackage(owned, undefined, undefined)?.id).toBe("pkg-new");
  });

  it("ignores a query id the viewer does not own", () => {
    expect(resolveActivePackage(owned, "pkg-foreign", "pkg-mid")?.id).toBe("pkg-mid");
    expect(resolveActivePackage(owned, "pkg-foreign", null)?.id).toBe("pkg-new");
  });

  it("ignores a cookie id the viewer does not own", () => {
    expect(resolveActivePackage(owned, null, "pkg-foreign")?.id).toBe("pkg-new");
  });

  it("returns null when the viewer owns no packages", () => {
    expect(resolveActivePackage([], "pkg-new", "pkg-new")).toBeNull();
  });

  it("never resolves a quick funnel package as active", () => {
    const packages = [pkg("quick", { kind: "quick" }), ...owned];
    expect(resolveActivePackage(packages, "quick", "quick")?.id).toBe("pkg-new");
  });
});
