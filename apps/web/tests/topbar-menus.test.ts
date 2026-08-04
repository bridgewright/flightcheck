import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("../components/TopBar.tsx", import.meta.url)),
  "utf-8",
);

// The top bar's half of F-56 (employer identity in the switcher) and all of
// F-57 (menus that dismiss like menus). The behaviour itself lives in the
// shared primitives and is tested there: light-dismiss-client.test.ts pins
// the listener wiring, components/light-dismiss.test.ts the decision, and
// package-identity-wiring.test.ts the identity's plumbing. What this file
// pins is that TopBar actually consumes those primitives, and consumes them
// the intended way. No DOM harness in this suite, so source is the pin.

describe("both top-bar menus dismiss through LightDismiss (F-57)", () => {
  it("replaces the raw details/summary pairs with the primitive", () => {
    expect(source).toContain('from "@/components/LightDismiss"');
    const uses = source.match(/<LightDismiss/g) ?? [];
    expect(uses.length).toBe(2);
    // No hand-rolled disclosure survives: the primitive renders the
    // details/summary structure itself.
    expect(source).not.toContain("<details");
    expect(source).not.toContain("<summary");
  });

  it("stays a server component; the primitive is the only client boundary", () => {
    expect(source).not.toContain('"use client"');
    // Dismissal is the primitive's job. The moment TopBar grows its own
    // listener or decision call, there are two opinions about closing.
    expect(source).not.toContain("addEventListener");
    expect(source).not.toContain("preventDefault");
    expect(source).not.toContain("dismissDecision");
  });

  it("anchors each panel through panelClassName, not its own wrapper", () => {
    expect(source).toContain("panelClassName={`${MENU_PANEL} left-0`}");
    expect(source).toContain("panelClassName={`${MENU_PANEL} right-0`}");
    // Import plus the two seats. A third use inside children would nest a
    // panel inside the panel LightDismiss already renders.
    const panels = source.match(/MENU_PANEL/g) ?? [];
    expect(panels.length).toBe(3);
  });

  it("keeps the order classes the wrapping mobile bar depends on", () => {
    expect(source).toContain('className="relative order-2"');
    expect(source).toContain('className="relative order-3 ml-auto sm:order-4"');
  });

  it("keeps the account trigger's accessible name", () => {
    expect(source).toContain('summaryLabel="Account menu"');
  });
});

describe("the switcher names the employer (F-56, top-bar half)", () => {
  it("seats PackageIdentity in the trigger and in every row, as rows", () => {
    expect(source).toContain('from "@/components/PackageIdentity"');
    const seats = source.match(/<PackageIdentity/g) ?? [];
    expect(seats.length).toBe(2);
    const rows = source.match(/variant="row"/g) ?? [];
    expect(rows.length).toBe(2);
    // The chip variant would dissolve into MENU_ROW's hover ground; the
    // component's own header records why.
    expect(source).not.toContain('variant="chip"');
  });

  it("passes the package fields straight through, no re-derivation", () => {
    expect(source).toContain("company={active.company}");
    expect(source).toContain("jdUrl={active.jd_url}");
    expect(source).toContain("company={pkg.company}");
    expect(source).toContain("jdUrl={pkg.jd_url}");
    // The trim/null and mark rules stay behind the component.
    expect(source).not.toContain("packageIdentityDecision");
    expect(source).not.toContain("companyMarkHost");
    expect(source).not.toContain("packageCompanyLine");
  });

  it("keeps the identity outside the trigger's truncating title span", () => {
    // The role title truncates as it always has; the identity sits before
    // that span with its own cap, so the mark is never what truncates.
    const identity = source.indexOf("company={active.company}");
    const titleSpan = source.indexOf("max-w-36 truncate sm:max-w-48");
    expect(identity).toBeGreaterThan(-1);
    expect(titleSpan).toBeGreaterThan(-1);
    expect(identity).toBeLessThan(titleSpan);
    // The cap's seat disappears entirely when the identity renders null, so
    // a package with no company shows exactly today's trigger, phantom-gap
    // free.
    expect(source).toContain("empty:hidden");
  });

  it("keeps the used/total count on the row's right edge", () => {
    expect(source).toContain("justify-between");
    expect(source).toContain("{pkg.sessions_used}/{pkg.total_sessions}");
    expect(source).toContain(
      "shrink-0 text-fine text-ink-faint tabular-nums",
    );
    // Hover stays the stock MENU_ROW transition.
    expect(source).toContain("${MENU_ROW} flex");
  });

  it("centers the row instead of baseline-aligning it", () => {
    // The left group is now a nested flex container, and a flex container
    // hands its first item's baseline up to the row. With a favicon mark
    // first, that baseline is the image's bottom edge: measured in headless
    // Chrome, items-baseline dropped the used/total count 3.9px below the
    // title and grew only the rows that carry a mark. items-center is exact
    // here because the title and the count share text-fine, so mark-less
    // rows keep their old pixels and marked rows stop zigzagging.
    expect(source).toContain("${MENU_ROW} flex items-center justify-between");
    expect(source).not.toContain("items-baseline");
  });
});
