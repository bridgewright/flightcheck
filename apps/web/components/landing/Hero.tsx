import { DISPLAY_HEADING, MUTED } from "@/lib/ui";

import CtaRow from "./CtaRow";
import { HERO } from "./copy";

// A single-column hero: the claim, the offer, and the two ways in.
//
// It briefly carried a live rubric-preview widget in a right pane (F-45).
// That shipped and was rolled back the same day — see DECISIONS 030. On the
// page it read as an unexplained box: an eyebrow, a bare textarea, and a
// disabled button, asking a stranger to paste something before the page had
// told them what this product is. The argument for the product has to land
// before an interaction is offered, not instead of it.

export default function Hero() {
  return (
    <div className="flex flex-col gap-6 pt-4 pb-4">
      <h1 className={DISPLAY_HEADING}>{HERO.heading}</h1>
      <p className={`${MUTED} max-w-xl text-lg leading-relaxed`}>{HERO.body}</p>
      <CtaRow
        label={HERO.primaryCta}
        secondary={{ label: HERO.secondaryCta, href: "/sample-report" }}
      />
    </div>
  );
}
