import Reveal from "@/components/motion/Reveal";
import { ENTRY_STAGGER_SECONDS } from "@/components/motion/entry";
import { CHIP_SKY, DIVIDER, SECTION_GAP, SECTION_HEADING } from "@/lib/ui";

// One scroll block. The market's polish bar is two-to-three viewport heights
// per section and never denser, with a hairline between them instead of a
// background change. The page should read as one calm document, not a deck.
//
// Two optional behaviours, both here rather than at the call sites so the page
// cannot get them slightly different in five places:
//
//   `revealBody` off, for a section whose contents animate themselves. Nesting
//   a block entry inside another block entry doubles the travel and the reader
//   sees motion for its own sake, which is the thing the budget exists to stop.
//
// A `wash` prop lived here for one day and carried an ambient blush field
// behind two blocks. It is gone: the reference puts its pastel in small label
// chips, not behind the type, and a background field is invisible next to what
// it was meant to reproduce while still costing a stacking context, two mask
// utilities, and a rendering artifact at the wrapper's edges.

export default function Section({
  id,
  label,
  heading,
  bordered = true,
  revealBody = true,
  children,
}: {
  id?: string;
  /** The small sky-blue chip above the heading. Rationed: at most one per
   * three sections, because an eyebrow above every section is the most
   * recognisable AI-design tell there is. */
  label?: string;
  heading?: string;
  bordered?: boolean;
  revealBody?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`w-full ${SECTION_GAP} ${bordered ? `border-t ${DIVIDER}` : ""}`}
    >
      {heading ? (
        <Reveal className="mb-8 flex flex-col items-start gap-3">
          {label ? <span className={CHIP_SKY}>{label}</span> : null}
          <h2 className={SECTION_HEADING}>{heading}</h2>
        </Reveal>
      ) : null}
      {revealBody ? (
        // One stagger step behind the heading, so a section names itself before
        // it makes its case.
        <Reveal delay={heading ? ENTRY_STAGGER_SECONDS : 0}>{children}</Reveal>
      ) : (
        children
      )}
    </section>
  );
}
