import Link from "next/link";

import { CTA_BUTTON, CTA_SECONDARY_BUTTON, FINE_PRINT } from "@/lib/ui";

import { FREE_ENTRY_MICROCOPY } from "./copy";

// The primary call to action, plus the one sentence that answers "what does
// this cost me to find out". Every scroll block re-offers this rather than
// relying on the nav. All three products in the competitive read do, and the
// microcopy under the button is the single highest-leverage line on the page.
//
// One component so the offer cannot drift between blocks: same words, same
// destination, same promise, wherever a visitor decides.
//
// `microcopy` is off in exactly one place, the hero, because a tiny tagline
// under the hero CTAs is a named ban (taste-skill 4.7) and the hero is allowed
// three text elements rather than four. It is a prop rather than a second
// component for the reason the file exists: forking CtaRow would let the offer
// say one thing in the hero and another further down. The line still appears
// under the page's one other CTA, so the dossier's "every scroll block
// re-offers one CTA with the microcopy under it" survives everywhere except
// the first viewport. That is a real trade, recorded as one. It said "all
// three" while this page had six blocks; it has four now, and only the close
// renders this component with microcopy.
//
// It also comes off for a signed-in visitor, wherever it appears: "First
// session free. No card." is an offer to someone deciding whether to open an
// account, and it is noise to someone who already has one.

export default function CtaRow({
  label,
  href = "/login?next=/new",
  secondary,
  align = "start",
  microcopy = true,
}: {
  label: string;
  href?: string;
  secondary?: { label: string; href: string };
  align?: "start" | "center";
  microcopy?: boolean;
}) {
  const alignment = align === "center" ? "items-center text-center" : "items-start";
  return (
    <div className={`flex flex-col gap-3 ${alignment}`}>
      <div className={`flex flex-wrap gap-3 ${align === "center" ? "justify-center" : ""}`}>
        <Link href={href} className={CTA_BUTTON}>
          {label}
        </Link>
        {secondary ? (
          <Link href={secondary.href} className={CTA_SECONDARY_BUTTON}>
            {secondary.label}
          </Link>
        ) : null}
      </div>
      {microcopy ? <p className={FINE_PRINT}>{FREE_ENTRY_MICROCOPY}</p> : null}
    </div>
  );
}
