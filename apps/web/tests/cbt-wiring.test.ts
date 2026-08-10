import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CBT surface wiring", () => {
  it("pins the client URL to the mounted route", () => {
    expect(source("components/redeem-code.tsx")).toContain('fetch("/api/cbt/redeem"');
    // The other half of the URL (PLAYBOOK 4.5b): the route file must exist at
    // the path the fetch names AND export the POST the fetch performs.
    // (The earlier form of this pin resolved a path and matched it against
    // itself — an assertion that passed with no route file at all.)
    expect(source("app/api/cbt/redeem/route.ts")).toContain("export async function POST");
  });

  it("refreshes the surface after a successful redeem", () => {
    expect(source("components/redeem-code.tsx")).toContain("router.refresh()");
  });

  it("dresses the code input in the house FIELD token, not a hand-rolled copy", () => {
    expect(source("components/redeem-code.tsx")).toContain("{FIELD}");
  });

  it("renders the redeem field on exactly home and settings", () => {
    const home = source("app/home/page.tsx");
    const settings = source("app/settings/page.tsx");
    expect(home).toContain("<RedeemCode />");
    expect(settings).toContain("<RedeemCode compact />");

    const otherOwnedSurfaces = ["app/api/cbt/redeem/route.ts", "lib/cbt.ts", "lib/home.ts", "lib/types.ts", "lib/worker.ts"];
    for (const path of otherOwnedSurfaces) expect(source(path)).not.toContain("<RedeemCode");
  });

  it("hides the field after redemption and omits spent entitlement copy", () => {
    expect(source("app/home/page.tsx")).toContain("cbt === null ? <RedeemCode /> : null");
    expect(source("app/settings/page.tsx")).toContain("cbt === null ? (");
    expect(source("lib/cbt.ts")).toContain("if (status.packages_remaining === 0) return null");
  });
});
