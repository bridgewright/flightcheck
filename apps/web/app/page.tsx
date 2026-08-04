import type { Metadata } from "next";

import CtaRow from "@/components/landing/CtaRow";
import Hero from "@/components/landing/Hero";
import HowItWorks from "@/components/landing/HowItWorks";
import PricingBlock from "@/components/landing/PricingBlock";
import Section from "@/components/landing/Section";
import { CLOSING, HERO, SIGNED_IN_CTA } from "@/components/landing/copy";
import Shell from "@/components/Shell";
import { PAGE_HEADING, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import { publicMetadata } from "./site";

// The landing page (F-46, recomposed in F-21). Screen parity with what the
// market's top three actually ship, minus everything in the dossier's AVOID
// list.
//
// The order is the argument: the hero states the claim and asks for nothing,
// how-it-works explains the loop, the price is itemized inline rather than
// hidden behind a click, and the close re-offers the one CTA. Two blocks carry
// a CTA at all: pricing, whose trial line is PRICING.trialNote, and the close,
// whose TRIAL_MICROCOPY comes through CtaRow. How-it-works is four steps and
// asks for nothing, which is deliberate and was described here for a while as
// carrying microcopy it has never had.
//
// Four blocks, not six. This comment described a two-up screenshot gallery and
// an on-page FAQ accordion for a while after both had gone: the gallery was
// removed with the hero screenshot, and the FAQ moved to its own /faq route
// when the page was cut down. Nothing enforces a comment, so it went stale
// silently while the file it describes was three blocks shorter than it said.
//
// The rule that does still hold is that no layout family repeats: a
// single-column hero, a numbered sequence in unequal pairs, a card beside
// prose, and a centered close.
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
  // The hero's own words, not a second copy of them. This is the browser tab,
  // the search result, and the link preview, and it used to say "a live
  // interviewer holds you to that role's real bar". The hero dropped "live"
  // deliberately (the interviewer is an AI and the FAQ says so; "live" invited
  // the reader to imagine a person) and the description kept it, because the
  // register test reaches copy.ts exports and not this file.
  description: HERO.body,
});

export default async function LandingPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer} width="wide">
      <Hero signedIn={viewer !== null} />

      {/* There was a "You are signed in. Go to your home" line here.
          It is gone because the CTA above now says that itself: a signed-in
          visitor was being offered "Sign in and start" with a note underneath
          explaining they were already signed in, which is one screen saying
          two things at once. The destination it pointed at is now the button. */}

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
          <CtaRow
            label={viewer ? SIGNED_IN_CTA : CLOSING.cta}
            href={viewer ? "/home" : undefined}
            align="center"
            microcopy={viewer === null}
          />
        </div>
      </Section>
    </Shell>
  );
}
