import Link from "next/link";

import { CTA_BUTTON, CTA_SECONDARY_BUTTON, FINE_PRINT } from "@/lib/ui";

import { TRIAL_MICROCOPY } from "./copy";

// The primary call to action, plus the one sentence that answers "what does
// this cost me to find out". Every scroll block re-offers this rather than
// relying on the nav — all three products in the competitive read do, and the
// microcopy under the button is the single highest-leverage line on the page.
//
// One component so the offer cannot drift between blocks: same words, same
// destination, same promise, wherever a visitor decides.

export default function CtaRow({
  label,
  href = "/login?next=/new",
  secondary,
  align = "start",
}: {
  label: string;
  href?: string;
  secondary?: { label: string; href: string };
  align?: "start" | "center";
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
      <p className={FINE_PRINT}>{TRIAL_MICROCOPY}</p>
    </div>
  );
}
