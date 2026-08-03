import Reveal from "@/components/motion/Reveal";
import { ENTRY_STAGGER_SECONDS } from "@/components/motion/entry";
import { AMBIENT_WASH, DIVIDER, SECTION_GAP, SECTION_HEADING } from "@/lib/ui";

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
//   `wash`, for the closing block. The ambient field needs a positioned,
//   isolated parent: without `isolate` a z-index of -1 escapes to the page
//   background and the gradient disappears. Its wrapper is masked at the edges
//   for the reason spelled out in Hero.tsx, which carries the page's other half
//   of the same field. It starts a quarter of the way down because the blush in
//   .ambient-wash is centred near the top of its own box, so a wrapper filling
//   the section puts the light in the padding above the heading rather than
//   behind it.

export default function Section({
  id,
  heading,
  bordered = true,
  revealBody = true,
  wash = false,
  children,
}: {
  id?: string;
  heading?: string;
  bordered?: boolean;
  revealBody?: boolean;
  wash?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`w-full ${SECTION_GAP} ${bordered ? `border-t ${DIVIDER}` : ""} ${
        wash ? "relative isolate" : ""
      }`}
    >
      {wash ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -z-10 top-1/4 bottom-0 -inset-x-6 mask-x-from-80% mask-t-from-92%"
        >
          <span className={AMBIENT_WASH} />
        </div>
      ) : null}
      {heading ? (
        <Reveal className="mb-8">
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
