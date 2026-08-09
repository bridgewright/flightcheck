import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PackageSummary } from "@/lib/worker";
import { resolveActivePackage, standardPackages } from "@/lib/active-package";

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

  it("resolves nothing when every package is a quick one", () => {
    const packages = [pkg("quick", { kind: "quick" })];
    expect(resolveActivePackage(packages, null, null)).toBeNull();
  });
});

describe("standardPackages", () => {
  it("drops quick packages and keeps the order of the rest", () => {
    const packages = [
      pkg("quick-a", { kind: "quick" }),
      ...owned,
      pkg("quick-b", { kind: "quick" }),
    ];
    expect(standardPackages(packages).map((p) => p.id)).toEqual([
      "pkg-new",
      "pkg-mid",
      "pkg-old",
    ]);
  });

  it("keeps a package a pre-quick worker serialized without a kind", () => {
    // kind is optional on PackageSummary: an older worker omits it, and
    // absence must read as "standard", never as "hide this customer's work".
    // Every row written before the quick feed existed is in this shape, and
    // hiding one would hide a package somebody paid for.
    expect(standardPackages(owned)).toHaveLength(3);
    expect(standardPackages([pkg("explicit", { kind: "standard" })])).toHaveLength(1);
  });

  it("filters a row shaped the way the list feed actually sends it", () => {
    // The worker's GET /users/{id}/packages feed carries kind, quick_company
    // and quick_role on every row. The filter reads kind off THAT feed, so a
    // wire-shaped row is what it has to recognize — if the feed ever stopped
    // sending kind, every row would read as standard and a quick package
    // could become somebody's active package.
    const wire = pkg("quick-wire", {
      kind: "quick",
      quick_company: "Acme",
      quick_role: "Deployment Strategist",
      total_sessions: 1,
      role_title: null,
    });
    expect(standardPackages([wire])).toEqual([]);
    expect(resolveActivePackage([wire], null, null)).toBeNull();
    expect(resolveActivePackage([wire, ...owned], "quick-wire", null)?.id).toBe(
      "pkg-new",
    );
  });
});

describe("every screen that lists packages goes through the filter", () => {
  // A quick package on /packages rendered as a card with a blank role,
  // "0 of 1 sessions used", an Open button onto a screen that resolves a
  // different package, and a Delete button. Two of the three callers filtered;
  // the overview was written before the filter existed and nothing pointed at
  // it, which is why the filter is now shared and this list is a test.
  const read = (path: string) =>
    readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), path), "utf8");

  it.each([
    "app/packages/page.tsx",
    "components/TopBar.tsx",
    // The archive lists EVERY package's sessions, not just the active one, so
    // resolveActivePackage's filter never protected it: a quick package
    // arrived as `others`, and for the funnel's own audience — someone whose
    // only package is the quick one — as `active`, via the `?? packages[0]`
    // fallback that hands back the raw head of the list.
    "app/sessions/page.tsx",
  ])("%s", (file) => {
    const source = read(file);
    expect(source).toContain("standardPackages(");
    for (const line of source.split("\n")) {
      if (!line.includes("listPackagesForUser(")) continue;
      expect(
        line.includes("standardPackages("),
        `${file}: this list is the raw worker response, so it includes quick funnel packages`,
      ).toBe(true);
    }
  });

  it("TopBar's switcher list is filtered on both of its paths", () => {
    // It takes the list as a prop when the page already fetched one, and
    // fetches its own otherwise. Only the fetching path was checked above,
    // and the prop path is the one every signed-in screen actually uses.
    const source = read("components/TopBar.tsx");
    const assignments = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^owned = /.test(line));
    expect(assignments).not.toHaveLength(0);
    for (const line of assignments) {
      expect(
        /^owned = (standardPackages\(|\[\];)/.test(line),
        `the switcher would list quick funnel packages: ${line}`,
      ).toBe(true);
    }
  });
});
