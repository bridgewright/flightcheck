import type { Metadata } from "next";
import Link from "next/link";

import CtaRow from "@/components/landing/CtaRow";
import Faq from "@/components/landing/Faq";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import PricingBlock from "@/components/landing/PricingBlock";
import Section from "@/components/landing/Section";
import Showcase from "@/components/landing/Showcase";
import { CLOSING } from "@/components/landing/copy";
import Shell from "@/components/Shell";
import { LINK, MUTED } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { publicMetadata } from "./site";

// The landing page (F-46). Screen parity with what the market's top three
// actually ship, minus everything in the dossier's AVOID list.
//
// The order is the argument: the hero shows the bar for YOUR job before
// asking for anything, how-it-works explains the loop, the screenshots prove
// it exists, the price is itemized inline rather than hidden behind a click,
// and the FAQ answers the six objections on the page instead of in a policy
// link. Every block re-offers one CTA with the trial microcopy under it.
//
// All prose lives in components/landing/copy.ts, where the register test can
// hold it to honest and calm; every number comes from lib/pricing.ts and
// app/legal/policy.ts through the same module.

export const metadata: Metadata = publicMetadata({
  path: "/",
  title: "flightcheck — would you pass the interview today?",
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
        <p className="pb-2 text-sm">
          <Link href="/home" className={LINK}>
            You are signed in — go to your home
          </Link>
        </p>
      ) : null}

      <Section heading="How it works">
        <HowItWorks />
      </Section>

      <Section heading="What you actually get">
        <Showcase />
        <div className="mt-10">
          <CtaRow label={CLOSING.cta} />
        </div>
      </Section>

      <Section heading="One package per job description">
        <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center">
          <PricingBlock />
          <p className={`${MUTED} max-w-sm text-sm leading-relaxed`}>
            {CLOSING.body}
          </p>
        </div>
      </Section>

      <Section heading="Questions people ask before paying">
        <Faq />
      </Section>

      <Section>
        <div className="flex flex-col items-center gap-5 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-balance">
            {CLOSING.heading}
          </h2>
          <CtaRow label={CLOSING.cta} align="center" />
        </div>
      </Section>
    </Shell>
  );
}
