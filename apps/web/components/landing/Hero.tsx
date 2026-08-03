import { DISPLAY_HEADING, MUTED } from "@/lib/ui";

import CtaRow from "./CtaRow";
import { HERO } from "./copy";
import RubricPreviewWidget from "./RubricPreviewWidget";

// The split hero: the claim and the offer on the left, the working product on
// the right.
//
// The right pane is the rubric preview, not a screenshot and not a video —
// the market's best hero puts a live widget there, and ours has something
// better to put in it than a demo. A stranger can paste the job description
// they are actually facing and see the bar, before signing up for anything.
// That is the argument for the product, made by the product.

export default function Hero() {
  return (
    <div className="grid items-start gap-10 pt-4 pb-4 lg:grid-cols-2 lg:gap-14">
      <div className="flex flex-col gap-6">
        <h1 className={DISPLAY_HEADING}>{HERO.heading}</h1>
        <p className={`${MUTED} max-w-xl text-lg leading-relaxed`}>{HERO.body}</p>
        <CtaRow
          label={HERO.primaryCta}
          secondary={{ label: HERO.secondaryCta, href: "/sample-report" }}
        />
      </div>
      <RubricPreviewWidget />
    </div>
  );
}
