import MountReveal from "@/components/motion/MountReveal";
import { DISPLAY_HEADING, HERO_BLOOM, MUTED } from "@/lib/ui";

import CtaRow from "./CtaRow";
import ScreenFrame from "./ScreenFrame";
import { HERO, HERO_SCREEN } from "./copy";

// An asymmetric split: the claim and the two ways in on the left, the product's
// own output framed on the right.
//
// Three text elements and no more, which is the cap: heading, a twenty-word
// subtext, and the CTA pair. The trial microcopy used to sit under the buttons
// and now sits under every other CTA on the page instead (see CtaRow).
//
// The right pane is a visual rather than decoration, because text plus a
// gradient is not a hero. It is currently the labelled placeholder rather than
// a capture, and that is the honest position: this pass is restyling the screen
// the capture would show, so a screenshot taken today would be a picture of a
// UI the buyer never sees. WHAT IS NEEDED, WHERE: one capture of the scored
// report at 16:9, dropped at public/screens/report.png, with `src` set on the
// "report" entry in copy.ts. That single string fills both this pane and the
// showcase.
//
// This does not reopen F-45. What was rolled back there was an interactive
// rubric-preview widget that demanded a paste before the page had made its
// argument (DECISIONS 030). A framed screen is proof and asks the visitor for
// nothing, so nothing in this pane takes input.
//
// Mobile, stated rather than assumed: below md the two panes stack in source
// order, claim first, at full width.

export default function Hero() {
  return (
    <div className="pt-2 pb-4">
      {/* The pink half of the reference's pastel language: a large soft cloud
          behind the top of the page. Full-bleed and fixed, so it has no edges
          to give itself away, which is what went wrong when this was a field
          confined to the content column. The other half, the sky-blue label
          chip, sits above each section heading. */}
      <div aria-hidden="true" className={HERO_BLOOM} />
      <MountReveal className="grid grid-cols-1 items-center gap-8 md:grid-cols-12 md:gap-12">
        <div className="flex flex-col gap-5 md:col-span-7">
          <h1 className={DISPLAY_HEADING}>{HERO.heading}</h1>
          <p className={`${MUTED} max-w-md`}>{HERO.body}</p>
          <CtaRow
            label={HERO.primaryCta}
            secondary={{ label: HERO.secondaryCta, href: "/sample-report" }}
            microcopy={false}
          />
        </div>
        <div className="md:col-span-5">
          <ScreenFrame
            title={HERO_SCREEN.title}
            caption={HERO_SCREEN.caption}
            src={HERO_SCREEN.src}
            captioned={false}
          />
        </div>
      </MountReveal>
    </div>
  );
}
