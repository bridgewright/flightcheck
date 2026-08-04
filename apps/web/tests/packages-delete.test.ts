import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-scan contract for package deletion (F-53), in the same shape as
// tests/settings-deletion.test.ts: the destructive control has to say what it
// destroys, in the page, before it runs.

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
/** Whole-line comments blanked, line count preserved. A file that explains
 * the pattern it forbids must not fail the check for that pattern. */
const withoutComments = (source: string) =>
  source.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, "");
const squish = (source: string) => source.replace(/\s+/g, " ");

const button = read("../components/DeletePackageButton.tsx");
const actions = read("../app/packages/actions.ts");
const page = read("../app/packages/page.tsx");

describe("the delete control", () => {
  it("is on the packages screen", () => {
    expect(page).toContain("DeletePackageButton");
    expect(page).toContain("deletePackageAction");
  });

  it("arms before it fires, and never through a browser dialog", () => {
    const code = withoutComments(button);
    expect(code).toContain("armed");
    expect(code).not.toMatch(/(^|[^.\w])confirm\(/);
    expect(code).not.toMatch(/(^|[^.\w])alert\(/);
  });

  it("names what goes, and says it cannot be undone", () => {
    const copy = squish(button);
    expect(copy).toContain("immediately and permanently");
    expect(copy).toContain("There is no undo");
    expect(copy).toContain("its rubric");
    expect(copy).toContain("every recording");
  });

  it("says the receipt survives, because it does", () => {
    // The worker deliberately leaves orders alone. If this copy and that
    // behaviour ever disagree, one of them is lying to a customer about
    // their money.
    expect(squish(button)).toContain("Your receipts stay in your order history");
  });
});

describe("the delete action", () => {
  it("refuses a signed-out caller before the worker hears anything", () => {
    expect(actions).toContain("You are signed out");
  });

  it("gives an unknown id and a foreign id the same answer", () => {
    expect(actions).toContain("NOT_DELETABLE");
  });

  it("relays the recordings-not-deleted case honestly", () => {
    // Blobs go before rows, so a 503 means NOTHING was deleted. Reporting
    // success here, or retrying quietly, would leave a customer believing
    // their audio is gone.
    expect(actions).toContain("err.status === 503");
    expect(squish(actions)).toContain("nothing was deleted");
  });
});

describe("the company mark keeps the image policy intact", () => {
  const route = read("../app/api/company-mark/[packageId]/route.ts");
  const mark = read("../components/CompanyMark.tsx");
  const headers = read("../lib/security-headers.ts");

  it("is served from our own origin, so img-src stays 'self'", () => {
    // Widening img-src to https: for a 16px decoration would give every
    // future injected <img> a way to signal out of a product that renders
    // model output. The proxy is what buys the policy staying tight.
    expect(mark).toContain("src={`/api/company-mark/");
    expect(headers).toContain('["img-src", ["\'self\'", "data:", "blob:"]]');
  });

  it("never lets the caller name the host", () => {
    // The route takes a package id, reads that package's own stored URL, and
    // vets it with the shared rule. That is what stops a proxy from being an
    // open fetcher.
    expect(route).toContain("listPackagesForUser");
    expect(route).toContain("companyMarkHost");
    expect(route).not.toMatch(/searchParams\.get\(\s*["'](url|host|domain)["']/);
  });

  it("bounds the request and refuses a redirect", () => {
    expect(route).toContain('redirect: "manual"');
    expect(route).toContain("AbortSignal.timeout");
    expect(route).toContain("MAX_BYTES");
    expect(route).toContain('startsWith("image/")');
  });

  it("fails into an absent mark rather than a broken one", () => {
    expect(mark).toContain("onError");
    expect(mark).toContain("setFailed(true)");
    expect(route).toContain("status: 404");
  });
});
