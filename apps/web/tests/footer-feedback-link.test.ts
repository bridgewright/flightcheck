import { describe, expect, it } from "vitest";
import * as policy from "@/app/legal/policy";

describe("feedback footer route", () => {
  it("is an internal footer link and no mailto contract remains", () => {
    expect(policy.FOOTER_LINKS).toContainEqual({ href: "/feedback", label: "Feedback" });
    expect(policy.FOOTER_LINKS.every((link) => link.href.startsWith("/"))).toBe(true);
    expect("feedbackMailto" in policy).toBe(false);
  });
});
