import { describe, expect, it } from "vitest";

import { companyMarkHost, faviconUrl } from "@/lib/company-mark";

// The rule that decides whether a package card may show an employer mark
// (F-54). It is the only guard on which domain the proxy route will fetch,
// so its refusals matter more than its acceptances.

describe("companyMarkHost accepts a domain the customer pasted", () => {
  it("takes the host of an https job posting", () => {
    expect(companyMarkHost("https://anthropic.com/careers/123")).toBe("anthropic.com");
    expect(companyMarkHost("https://jobs.example.co.uk/roles/7")).toBe("jobs.example.co.uk");
  });

  it("lowercases, because a host is case-insensitive and a URL is not", () => {
    expect(companyMarkHost("https://Anthropic.COM/careers")).toBe("anthropic.com");
  });
});

describe("companyMarkHost refuses what would be a wrong mark", () => {
  it("refuses job boards and applicant tracking systems", () => {
    // The icon would load fine, which is the danger: a Greenhouse mark beside
    // a company name reads as "this company is Greenhouse".
    for (const url of [
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://jobs.lever.co/acme/abc",
      "https://acme.myworkdayjobs.com/en-US/careers/job/1",
      "https://www.linkedin.com/jobs/view/123",
      "https://www.wanted.co.kr/wd/12345",
      "https://acme.notion.site/role",
    ]) {
      expect(companyMarkHost(url), url).toBeNull();
    }
  });

  it("refuses when there is no URL at all", () => {
    // The common case: the customer pasted the JD text.
    expect(companyMarkHost(null)).toBeNull();
    expect(companyMarkHost(undefined)).toBeNull();
    expect(companyMarkHost("   ")).toBeNull();
    expect(companyMarkHost("not a url")).toBeNull();
  });
});

describe("companyMarkHost refuses what would be a request we should not make", () => {
  it("refuses anything but https", () => {
    expect(companyMarkHost("http://anthropic.com/careers")).toBeNull();
    expect(companyMarkHost("file:///etc/passwd")).toBeNull();
    expect(companyMarkHost("javascript:alert(1)")).toBeNull();
  });

  it("refuses credentials in the URL, which the fetch would send", () => {
    expect(companyMarkHost("https://user:pw@anthropic.com/careers")).toBeNull();
  });

  it("refuses addresses that point back inside", () => {
    // Defence in depth: the proxy takes a package id and never a host, so a
    // caller cannot aim this. The stored value still came from a form.
    for (const url of [
      "https://localhost/favicon.ico",
      "https://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/",
      "https://build.internal/",
      "https://printer.local/",
      "https://[::1]/",
    ]) {
      expect(companyMarkHost(url), url).toBeNull();
    }
  });
});

describe("faviconUrl", () => {
  it("varies only the host", () => {
    expect(faviconUrl("anthropic.com")).toBe("https://anthropic.com/favicon.ico");
  });
});
