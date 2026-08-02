import Link from "next/link";

import TopBar from "@/components/TopBar";
import { getViewer } from "@/lib/viewer";

const LABEL = "text-[10px] font-semibold tracking-wide text-neutral-500 uppercase";

// UI only. No PSP, no card fields, no order record — the payments feature
// wires those up, and pretending otherwise here would collect details this
// product cannot yet honour.
export default async function CheckoutPage() {
  const viewer = await getViewer();
  return (
    <>
      <TopBar viewer={viewer} />
      <main className="mx-auto flex w-full max-w-md flex-col px-6 pt-14 pb-16">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Payments aren&apos;t open yet.
        </h1>
        <p className="mt-3 text-neutral-600 dark:text-neutral-400">
          This package flow goes live soon — everything else already works.
        </p>
        <section className="mt-7 rounded-md border border-neutral-300 bg-neutral-50 px-5 py-5 dark:border-neutral-700 dark:bg-neutral-900">
          <div className={LABEL}>Interview package · 30 days</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span className="text-3xl font-bold tabular-nums">₩89,000</span>
            <span className="text-sm text-neutral-600 dark:text-neutral-400">per job description</span>
          </div>
          <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
            6 live sessions, ~20 minutes each, against a rubric compiled from the job
            description you paste.
          </p>
        </section>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link
            href="/new"
            className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Start with a job description
          </Link>
          <Link href="/pricing" className="text-sm underline underline-offset-4">
            Back to pricing
          </Link>
        </div>
      </main>
    </>
  );
}
