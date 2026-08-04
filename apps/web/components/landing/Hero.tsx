import MountReveal from "@/components/motion/MountReveal";
import { DISPLAY_HEADING, HERO_BLOOM, MUTED, PROSE_WIDTH } from "@/lib/ui";

import CtaRow from "./CtaRow";
import { HERO, SIGNED_IN_CTA } from "./copy";

// The claim, the offer, and the two ways in. Nothing else.
//
// Three text elements and no more: heading, a twenty-word subtext, and the CTA
// pair. The trial microcopy used to sit under the buttons and now sits under
// every other CTA on the page instead (see CtaRow).
//
// **Nothing goes in the right of this hero.** That space is the point: the
// reference this design follows opens on a claim in a very large amount of
// air, and every time something has been put beside the claim here it has had
// to come back out. F-45 put an interactive rubric-preview widget there and it
// was rolled back the same day (DECISIONS 030). A framed screenshot replaced
// it, argued for on the grounds that "text plus a gradient is not a hero", and
// that came out too. The rule is now written where the next person will read
// it before adding the third one: the hero carries words and a control, the
// pink cloud behind them is the visual, and the product's screens prove
// themselves further down the page where a reader has asked for proof.
//
// Mobile needs no special case any more, because there is only one column.

export default function Hero({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="pt-2 pb-4">
      {/* The pink half of the reference's pastel language: a large soft cloud
          behind the top of the page. Full-bleed and absolute, so it has no
          edges to give itself away and it scrolls off with the hero. The other
          half, the sky-blue label chip, sits above each section heading. */}
      <div aria-hidden="true" className={HERO_BLOOM} />
      <MountReveal className="flex flex-col gap-6 py-10 md:py-16">
        <h1 className={`${DISPLAY_HEADING} max-w-3xl`}>{HERO.heading}</h1>
        {/* Was max-w-md, which is 392px. Measured in a browser, that let the
            subtext use about a third of a 1120px content column while the
            heading above it used 672px, so the paragraph stopped well short of
            the line the claim had just drawn and the hero read as narrow. This
            is the reading measure, which is the constraint that belongs here:
            wide enough to sit under the claim, still short of the point where
            the eye loses the line. */}
        <p className={`${MUTED} ${PROSE_WIDTH}`}>{HERO.body}</p>
        <CtaRow
          label={signedIn ? SIGNED_IN_CTA : HERO.primaryCta}
          href={signedIn ? "/home" : undefined}
          secondary={{ label: HERO.secondaryCta, href: "/sample-report" }}
          microcopy={false}
        />
      </MountReveal>
    </div>
  );
}
