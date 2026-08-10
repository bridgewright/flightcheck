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

  it("refreshes the surface after a successful redeem, through the real router", () => {
    const component = source("components/redeem-code.tsx");
    expect(component).toContain("router.refresh()");
    // The refresh has to be the Next router's. A round-2 mutation shadowed the
    // symbol this pin greps for — `const router = { refresh: () => {} }` — and
    // the pin stayed green over a dead refresh while lint only warned about
    // the unused import. So the one and only `router` binding must be the
    // hook's, which also blocks an inner shadow inside submit().
    expect(component.match(/\bconst router\b/g)).toHaveLength(1);
    expect(component).toContain("const router = useRouter()");
  });

  it("derives the rendered result from the response status, not the body's shape", () => {
    // lib/cbt.test.ts proves cbtRedeemResult; this pin proves the component
    // consumes it (4.5b one level up: a tested pure function nothing calls
    // vouches for nothing). Without it, a codeless refusal body read as
    // success and rendered "Code accepted ... until undefined."
    expect(source("components/redeem-code.tsx")).toContain("cbtRedeemResult(response.status");
  });

  it("dresses the code input in the house FIELD token, and nothing else", () => {
    // Exact consumption, not a substring. The round-1 pin was
    // `toContain("{FIELD}")`, which `${FIELD}` inside any template literal
    // satisfies — so `` className={`${FIELD} bg-red-` + "500"} `` walked a raw
    // palette class past this pin, the token-vocabulary scan (the literal is
    // split across fragments), typecheck, and lint in one move. The input's
    // className must BE the token: any wrapper or concatenation fails here
    // and has to argue its case in this file.
    expect(source("components/redeem-code.tsx")).toContain('className={FIELD} />');
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
