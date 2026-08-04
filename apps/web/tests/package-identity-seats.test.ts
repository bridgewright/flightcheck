import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The page half of F-56: every page line that names a package carries the
// shared PackageIdentity component, so which-employer-is-this is answered by
// one rule instead of five ad-hoc ones. These pages have no render harness
// (environment: node, and they reach for cookies and the worker), so this is
// a source-scan contract in the house style, like checkout-confirm.test.ts.
//
// What it holds: each seat renders the component, no page re-derives the
// trim or mark rules the component owns, the honest-absence branch keeps the
// line's original markup, and the rubric page no longer prints the company
// as ad-hoc text.

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const PAGES = {
  "app/home/page.tsx": read("../app/home/page.tsx"),
  "app/sessions/page.tsx": read("../app/sessions/page.tsx"),
  "app/progress/page.tsx": read("../app/progress/page.tsx"),
  "app/rubric/page.tsx": read("../app/rubric/page.tsx"),
  "app/checkout/page.tsx": read("../app/checkout/page.tsx"),
} as const;

const files = Object.keys(PAGES) as (keyof typeof PAGES)[];

/** How many identity seats each page owns. Home counts its failed-compile
 * branch and its main subtitle; sessions counts the active subtitle and the
 * other-package group heading. */
const SEATS: Record<keyof typeof PAGES, number> = {
  "app/home/page.tsx": 2,
  "app/sessions/page.tsx": 2,
  "app/progress/page.tsx": 1,
  "app/rubric/page.tsx": 1,
  "app/checkout/page.tsx": 1,
};

describe("every package-naming page line carries PackageIdentity", () => {
  it.each(files)("%s imports the shared component", (file) => {
    expect(PAGES[file]).toContain('from "@/components/PackageIdentity"');
  });

  it.each(files)("%s renders it at every seat it owns", (file) => {
    const rendered = (PAGES[file].match(/<PackageIdentity/g) ?? []).length;
    expect(rendered).toBeGreaterThanOrEqual(SEATS[file]);
  });

  it.each(files)("%s uses the chip variant, the page-subtitle one", (file) => {
    // "row" belongs to the dense top-bar menu seats (Track C). A page
    // subtitle stands beside a heading, which is what the chip is for.
    expect(PAGES[file]).toContain('variant="chip"');
    expect(PAGES[file]).not.toContain('variant="row"');
  });
});

describe("the identity rules live in one place", () => {
  it.each(files)("%s never re-derives the trim or mark rules", (file) => {
    // packageIdentityDecision owns both, behind the component. A page that
    // trims a company name or asks companyMarkHost itself has forked the
    // rule the component exists to unify.
    expect(PAGES[file]).not.toContain("companyMarkHost");
    expect(PAGES[file]).not.toContain(".trim()");
  });

  it.each(files)(
    "%s branches on the shared decision, not its own null test",
    (file) => {
      // The no-company line must keep its original markup, byte for byte:
      // the chip layout (a truncating flex row) exists only when there is a
      // chip. The branch key is the same decision the component consults, so
      // page and component can never disagree about absence.
      expect(PAGES[file]).toContain('from "@/components/package-identity"');
      expect(PAGES[file]).toContain("packageIdentityDecision(");
    },
  );

  it("the rubric page prints the company through the component alone", () => {
    // It used to render `rubric.company · ` as ad-hoc text, untrimmed and
    // outside the shared rule. The seat is PackageIdentity now; the ad-hoc
    // path must not survive beside it.
    expect(PAGES["app/rubric/page.tsx"]).not.toContain("rubric.company");
  });
});

describe("the counter tail survives small screens", () => {
  // The truncation rule: a long role title gives way; "X of Y sessions"
  // never does. The tail span is pinned nowrap wherever a seat carries one.
  it.each([
    "app/home/page.tsx",
    "app/sessions/page.tsx",
    "app/progress/page.tsx",
  ] as const)("%s keeps its session counter whole", (file) => {
    expect(PAGES[file]).toContain('className="whitespace-nowrap');
  });
});
