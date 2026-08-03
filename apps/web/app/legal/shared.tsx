// Shared frame for the three legal pages so they read as one document set:
// same title block, same "Last updated" line, same section rhythm. Content
// stays in each page; only the skeleton lives here.
//
// Styled from lib/ui.ts tokens (batch decision D2) so the F-21 design pass
// re-points a palette rather than re-authoring three legal pages.

import { MUTED, PAGE_HEADING, SUBTLE } from "@/lib/ui";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-8">
      <header>
        <h1 className={PAGE_HEADING}>{title}</h1>
        <p className={`${SUBTLE} mt-1`}>Last updated {updated}</p>
      </header>
      {children}
    </article>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold tracking-tight">{heading}</h2>
      <div className={`${MUTED} flex flex-col gap-3 text-sm leading-relaxed`}>
        {children}
      </div>
    </section>
  );
}
