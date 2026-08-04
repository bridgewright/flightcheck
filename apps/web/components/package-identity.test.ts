import { describe, expect, it } from "vitest";

import { packageIdentityDecision } from "@/components/package-identity";

// Whether a surface may print an employer identity at all, and whether the
// mark rides along (F-56). The rules themselves belong to lib/home
// (packageCompanyLine) and lib/company-mark (companyMarkHost); this suite
// holds the composition every seat now shares.

describe("packageIdentityDecision renders nothing without an honest name", () => {
  it("is null when the rubric named no company", () => {
    expect(packageIdentityDecision(null, "https://anthropic.com/careers/1")).toBeNull();
    expect(packageIdentityDecision(undefined, null)).toBeNull();
  });

  it("is null on whitespace, the same as the card rule", () => {
    // A blank line would say the compiler found nothing when it may simply
    // not have run yet, so the surface renders exactly as it does today.
    expect(packageIdentityDecision("", null)).toBeNull();
    expect(packageIdentityDecision("   ", "https://anthropic.com/careers/1")).toBeNull();
  });
});

describe("packageIdentityDecision with a company name", () => {
  it("prints the name alone when no URL earns a mark", () => {
    expect(packageIdentityDecision("Anthropic", null)).toEqual({
      company: "Anthropic",
      showMark: false,
    });
    expect(packageIdentityDecision("Anthropic", undefined)).toEqual({
      company: "Anthropic",
      showMark: false,
    });
  });

  it("refuses the mark for a job-board URL, name only", () => {
    // The Greenhouse icon beside a company name would say the employer is
    // Greenhouse. companyMarkHost owns that refusal; it must hold here too.
    expect(
      packageIdentityDecision("Acme", "https://boards.greenhouse.io/acme/jobs/1"),
    ).toEqual({ company: "Acme", showMark: false });
    expect(packageIdentityDecision("Acme", "http://acme.com/jobs/1")).toEqual({
      company: "Acme",
      showMark: false,
    });
  });

  it("shows the mark when the pasted URL is the employer's own", () => {
    expect(
      packageIdentityDecision("Anthropic", "https://anthropic.com/careers/1"),
    ).toEqual({ company: "Anthropic", showMark: true });
  });

  it("trims through packageCompanyLine rather than re-deriving it", () => {
    expect(packageIdentityDecision("  Anthropic  ", null)).toEqual({
      company: "Anthropic",
      showMark: false,
    });
  });
});
