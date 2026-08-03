import Link from "next/link";

import {
  CARD,
  DIVIDER,
  FINE_PRINT,
  LABEL,
  MUTED,
  PRIMARY_BUTTON,
  SUBTLE,
} from "@/lib/ui";

import { PRICING, PRICING_LINES } from "./copy";

// The paywall block, shared by the landing page and /pricing so the offer can
// never differ between where someone reads it and where they act on it.
//
// F-43. Two things sit here deliberately, both from the checkout patterns
// worth copying: the itemized list of what unlocks goes ABOVE the number, so
// the price is read against something concrete rather than against nothing;
// and the refund sentence sits directly above the button, at the moment the
// hesitation actually happens, rather than three clicks away in a policy page.
//
// What is deliberately absent is as considered as what is here: no countdown,
// no "was $99", no seat counter, no discount stacking. A product whose
// verdicts have to be trusted cannot manufacture urgency about them.
//
// Every number comes from lib/pricing.ts and app/legal/policy.ts through
// ./copy.ts. Nothing on this screen is a literal.

export default function PricingBlock({
  ctaLabel = PRICING.cta,
  ctaHref = "/checkout",
}: {
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <article className={`${CARD} w-full max-w-[470px]`}>
      <div className="flex flex-col gap-5 px-5 py-5">
        <div>
          <div className={LABEL}>What unlocks</div>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {PRICING_LINES.map((line) => (
              <li key={line.label} className="flex items-baseline gap-2.5">
                <span aria-hidden="true" className={SUBTLE}>
                  —
                </span>
                <span>
                  <b className="font-medium">{line.label}</b>{" "}
                  <span className={MUTED}>{line.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`flex flex-wrap items-baseline gap-2.5 border-t pt-5 ${DIVIDER}`}>
          <span className="text-3xl font-bold tabular-nums">{PRICING.price}</span>
          <span className={`${MUTED} text-sm`}>{PRICING.priceNote}</span>
        </div>
        {/* Directly above the button, where the hesitation is. */}
        <p className={FINE_PRINT}>{PRICING.refundLine}</p>
        <Link href={ctaHref} className={`${PRIMARY_BUTTON} text-center`}>
          {ctaLabel}
        </Link>
        <p className={FINE_PRINT}>{PRICING.trialNote}</p>
      </div>
    </article>
  );
}
