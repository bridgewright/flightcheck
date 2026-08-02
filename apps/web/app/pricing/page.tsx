import Link from "next/link";

import TopBar from "@/components/TopBar";
import { getViewer } from "@/lib/viewer";

const LABEL = "text-[9.5px] font-bold tracking-[.11em] text-faint uppercase";

const INCLUDED = [
  "6 live sessions with your interviewer, ~20 minutes each",
  "A rubric compiled from the actual JD you're facing",
  "Fresh topics every session — practice until you're ready",
  "Per-session reports: content and delivery, scored separately",
  "A final honest verdict: ready, or what's still missing",
];

export default async function PricingPage() {
  const viewer = await getViewer();
  return (
    <>
      <TopBar viewer={viewer} />
      <main className="mx-auto flex w-full max-w-xl flex-col items-center px-6 pt-14 pb-16">
        <h1 className="text-center font-display text-[27px] font-[460] text-balance">
          One package per job description.
        </h1>
        {/* The package is the same object the dashboard hands back: one ticket,
            one job description, six sessions on it. */}
        <article className="mt-7 grid w-full max-w-[470px] grid-cols-[1fr_84px] overflow-hidden rounded-[14px] border border-[#2c3a5e] bg-[linear-gradient(175deg,var(--color-night-2)_0%,#131b33_100%)] shadow-[0_2px_6px_rgba(0,0,0,.35),0_18px_48px_rgba(0,0,0,.45)] sm:grid-cols-[1fr_96px]">
          <div className="flex flex-col gap-4 px-[22px] py-5">
            <div>
              <div className={LABEL}>Interview package · 30 days</div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-[32px] font-bold tabular-nums">₩89,000</span>
                <span className="text-[12.5px] text-muted">per job description</span>
              </div>
            </div>
            <ul className="flex flex-col gap-2 text-[13.5px] text-muted">
              {INCLUDED.map((line) => (
                <li key={line} className="flex items-baseline gap-2.5">
                  <span aria-hidden="true" className="font-bold text-coral">
                    —
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/checkout"
              className="rounded-[10px] bg-coral px-5 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#c96a4a]"
            >
              Continue to payment
            </Link>
          </div>
          {/* Centred rather than spread: this card is twice the height of the
              session ticket, and pinning the label and barcode to the ends
              leaves a long empty channel between them. */}
          <div className="flex flex-col items-center justify-center gap-4 border-l-2 border-dashed border-faint bg-night-1 px-3 py-4">
            <span className={LABEL}>Package</span>
            <span
              aria-hidden="true"
              className="h-9 w-[58px] bg-[repeating-linear-gradient(90deg,var(--color-muted)_0_2px,transparent_2px_5px)] opacity-55"
            />
          </div>
        </article>
      </main>
    </>
  );
}
