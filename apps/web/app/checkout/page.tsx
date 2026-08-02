import Link from "next/link";

import TopBar from "@/components/TopBar";
import { getViewer } from "@/lib/viewer";

const LABEL = "text-[9.5px] font-bold tracking-[.11em] text-faint uppercase";

// UI only. No PSP, no card fields, no order record — the payments feature
// wires those up, and pretending otherwise here would collect details this
// product cannot yet honour.
export default async function CheckoutPage() {
  const viewer = await getViewer();
  return (
    <>
      <TopBar viewer={viewer} />
      <main className="mx-auto flex w-full max-w-md flex-col px-6 pt-14 pb-16">
        <h1 className="font-display text-[27px] font-[460] text-balance">
          Payments aren&apos;t open yet.
        </h1>
        <p className="mt-3 text-[15px] text-muted">
          This package flow goes live soon — everything else already works.
        </p>
        <section className="mt-7 rounded-[14px] border border-line bg-night-1 px-5 py-5">
          <div className={LABEL}>Interview package · 30 days</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span className="text-[28px] font-bold tabular-nums">₩89,000</span>
            <span className="text-[12.5px] text-muted">per job description</span>
          </div>
          <p className="mt-3 text-[13.5px] text-muted">
            6 live sessions, ~20 minutes each, against a rubric compiled from the job
            description you paste.
          </p>
        </section>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link
            href="/new"
            className="rounded-[10px] bg-coral px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#c96a4a]"
          >
            Start with a job description
          </Link>
          <Link href="/pricing" className="text-[13.5px] text-muted hover:text-ink">
            Back to pricing
          </Link>
        </div>
      </main>
    </>
  );
}
