import { DIVIDER, SECTION_GAP, SECTION_HEADING } from "@/lib/ui";

// One scroll block. The market's polish bar is two-to-three viewport heights
// per section and never denser, with a hairline between them instead of a
// background change — the page should read as one calm document, not a deck.

export default function Section({
  id,
  heading,
  bordered = true,
  children,
}: {
  id?: string;
  heading?: string;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`w-full ${SECTION_GAP} ${bordered ? `border-t ${DIVIDER}` : ""}`}
    >
      {heading ? <h2 className={`${SECTION_HEADING} mb-8`}>{heading}</h2> : null}
      {children}
    </section>
  );
}
