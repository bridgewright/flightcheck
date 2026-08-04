import type { Metadata } from "next";

import Faq from "@/components/landing/Faq";
import CtaRow from "@/components/landing/CtaRow";
import Section from "@/components/landing/Section";
import Shell from "@/components/Shell";
import { CLOSING, FAQ } from "@/components/landing/copy";
import { MUTED, PAGE_HEADING, PROSE_WIDTH } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { publicMetadata } from "../site";

// The six questions people ask before paying, on their own page.
//
// They used to sit at the bottom of the landing. Moving them is a real trade
// and it is recorded as one: all three of the market's largest players answer
// objections on the landing itself rather than behind a link, and this page is
// one click further away than that. What buys the trade
// is that the landing now reads as four blocks instead of six, which is the
// thing that made it feel heavy.
//
// The answers are unchanged and still come from components/landing/copy.ts,
// so the register test reaches them here exactly as it did there, and the
// numbers still resolve through lib/pricing.ts and app/legal/policy.ts. A
// promise cannot drift between this page and the checkout that honours it.

export const metadata: Metadata = publicMetadata({
  path: "/faq",
  title: "Questions people ask before paying: flightcheck",
  description:
    "What the verdict means, what happens to your recording, how refunds " +
    "work, and why this is built for non-native English speakers.",
});

export default async function FaqPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer} width="wide">
      <div className="flex flex-col gap-3 pt-2 pb-4">
        <h1 className={PAGE_HEADING}>Questions people ask before paying</h1>
        <p className={`${MUTED} ${PROSE_WIDTH}`}>
          {FAQ.length} of them, answered here rather than in a policy link.
        </p>
      </div>

      <Section bordered={false}>
        <Faq />
      </Section>

      <Section>
        <div className="flex flex-col items-start gap-5">
          <h2 className={PAGE_HEADING}>{CLOSING.heading}</h2>
          <CtaRow label={CLOSING.cta} />
        </div>
      </Section>
    </Shell>
  );
}
