import Link from "next/link";

import Shell from "@/components/Shell";
import { EXPIRY_DAYS, PACKAGE_SESSIONS, PRICE_DISPLAY } from "@/lib/pricing";
import { LABEL, PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";

const INCLUDED = [
  `${PACKAGE_SESSIONS} live sessions with your interviewer, ~20 minutes each`,
  "A rubric compiled from the actual JD you're facing",
  "Fresh topics every session — practice until you're ready",
  "Per-session reports: content and delivery, scored separately",
  "A final honest verdict: ready, or what's still missing",
];

export default async function PricingPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col items-center pt-4">
        <h1 className="text-center text-2xl font-bold tracking-tight text-balance">
          One package per job description.
        </h1>
        {/* The package is the same object the dashboard hands back: one ticket,
            one job description, six sessions on it. */}
        <article className="mt-7 w-full max-w-[470px] rounded-md border border-neutral-300 dark:border-neutral-700">
          <div className="flex flex-col gap-4 px-5 py-5">
            <div>
              <div className={LABEL}>Interview package · 30 days</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
                <span className="text-3xl font-bold tabular-nums">{PRICE_DISPLAY}</span>
                <span className="text-sm text-neutral-600 dark:text-neutral-400">
                  per job description
                </span>
              </div>
            </div>
            <ul className="flex flex-col gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              {INCLUDED.map((line) => (
                <li key={line} className="flex items-baseline gap-2.5">
                  <span aria-hidden="true">—</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <Link href="/checkout" className={`${PRIMARY_BUTTON} text-center`}>
              Continue to payment
            </Link>
            {/* The trial model, stated where the price is: the charge is an
                unlock of the package the trial already opened, not a second
                product. */}
            <p className="text-xs text-neutral-500">
              Your first package starts as a free trial — one full session,
              scored. The {PRICE_DISPLAY} unlock opens the remaining sessions
              on that same package for {EXPIRY_DAYS} days.
            </p>
          </div>
        </article>
      </div>
    </Shell>
  );
}
