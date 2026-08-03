import type { Metadata } from "next";
import Link from "next/link";

import CtaRow from "@/components/landing/CtaRow";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import PricingBlock from "@/components/landing/PricingBlock";
import Section from "@/components/landing/Section";
import { CLOSING } from "@/components/landing/copy";
import Shell from "@/components/Shell";
import { LINK, PAGE_HEADING, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { publicMetadata } from "./site";

// The landing page (F-46, recomposed in F-21). Screen parity with what the
// market's top three actually ship, minus everything in the dossier's AVOID
// list.
//
// The order is the argument: the hero shows the bar for YOUR job before
// asking for anything, how-it-works explains the loop, the screenshots prove
// it exists, the price is itemized inline rather than hidden behind a click,
// and the FAQ answers the six objections on the page instead of in a policy
// link. Every block re-offers one CTA, and all but the hero carry the trial
// microcopy under it.
//
// Six layout families for six blocks, which is what keeps the page from
// reading as one template repeated: an asymmetric split hero, a numbered
// sequence in unequal pairs, a two-up frame gallery, a card beside prose, an
// accordion, and a centered close. No family appears twice.
//
// All prose lives in components/landing/copy.ts, where the register test can
// hold it to honest and calm; every number comes from lib/pricing.ts and
// app/legal/policy.ts through the same module.

export const metadata: Metadata = publicMetadata({
  path: "/",
  // A colon rather than the dash this used to carry. The title is a
  // user-visible string: it is the browser tab, the search result, and the
  // link preview.
  title: "flightcheck: would you pass the interview today?",
  description:
    "Paste the job description you're facing. A live interviewer holds you to " +
    "that role's real bar, in English, out loud, and tells you honestly what " +
    "is still missing.",
});

export default async function LandingPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer} width="wide">
      <Hero />

      {viewer ? (
        // Two sentences rather than one dash, and the link now names its own
        // destination instead of opening with a status.
        <p className={`${SUBTLE} pb-2`}>
          You are signed in.{" "}
          <Link href="/home" className={LINK}>
            Go to your home
          </Link>
        </p>
      ) : null}

      <Section label="How it works" heading="Paste a job. Talk. Read the verdict." revealBody={false}>
        <HowItWorks />
      </Section>

      <Section label="Pricing" heading="One package per job description.">
        <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center">
          <PricingBlock />
          <p className={`${SUBTLE} max-w-sm`}>
            {CLOSING.body}
          </p>
        </div>
      </Section>

      <Section>
        <div className="flex flex-col items-center gap-5 text-center">
          <h2 className={PAGE_HEADING}>{CLOSING.heading}</h2>
          <CtaRow label={CLOSING.cta} align="center" />
        </div>
      </Section>
    </Shell>
  );
}
