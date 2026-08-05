import { describe, expect, it } from "vitest";

import {
  FEEDBACK_SUBJECT,
  FOOTER_LINKS,
  SUPPORT_EMAIL,
  feedbackMailto,
} from "@/app/legal/policy";

// F-59, the feedback door: a labelled mailto to the existing support
// address, no new data surface. The footer renders it as a plain anchor
// beside the FAQ and policy links.
describe("feedbackMailto", () => {
  it("targets the support address with the feedback subject prefilled", () => {
    expect(feedbackMailto()).toBe(
      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}`,
    );
    expect(FEEDBACK_SUBJECT).toBe("Feedback on flightcheck");
  });

  it("prefills no body: the first words belong to the customer", () => {
    expect(feedbackMailto()).not.toContain("body=");
  });

  it("stays out of FOOTER_LINKS: those render as next/link routes", () => {
    // A mailto inside next/link is wrong (client-side navigation of a
    // non-route), so the footer renders this one as a plain <a> instead.
    for (const link of FOOTER_LINKS) {
      expect(link.href.startsWith("/")).toBe(true);
    }
  });
});
