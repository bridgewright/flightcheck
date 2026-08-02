import Link from "next/link";

import Shell from "@/components/Shell";
import { getViewer } from "@/lib/viewer";

// The 90-second staged session capture is not recorded yet. Set this to the
// published asset URL and the hero becomes a real player; until then the panel
// says so plainly rather than dangling a play button that does nothing.
const DEMO_VIDEO_URL: string | null = null;

const FEATURES = [
  {
    title: "A rubric from your actual JD",
    detail: "Not generic questions — the bar this role really interviews against.",
  },
  {
    title: "Voice, not text",
    detail: "Real speech both ways. Your delivery is scored from raw audio.",
  },
  {
    title: "Honest verdicts",
    detail: "Ready or not yet — and exactly what to fix first.",
  },
];

function DemoVideo() {
  if (DEMO_VIDEO_URL) {
    return (
      <video
        className="aspect-video w-full rounded-md border border-neutral-300 dark:border-neutral-700"
        src={DEMO_VIDEO_URL}
        controls
        preload="metadata"
      />
    );
  }
  return (
    <div className="relative flex aspect-video w-full items-center justify-center rounded-md border border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full border border-neutral-300 dark:border-neutral-700"
      >
        <span className="ml-1.5 border-y-[12px] border-l-[20px] border-y-transparent border-l-neutral-400" />
      </span>
      <span className="absolute bottom-3.5 left-4 text-xs text-neutral-500">
        Demo video — coming soon
      </span>
    </div>
  );
}

export default async function LandingPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer} width="wide">
      <section className="mx-auto flex w-full max-w-3xl flex-col pt-6 pb-14 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-balance md:text-5xl">
            Would you pass the interview <em>today?</em>
          </h1>
          <p className="mx-auto mt-4 mb-8 max-w-xl text-neutral-600 dark:text-neutral-400">
            Paste the job description you&apos;re facing. A live interviewer holds you
            to that role&apos;s real bar — in English, out loud — and tells you honestly
            what&apos;s still missing. Repeat until you&apos;d pass.
          </p>
          <DemoVideo />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="rounded-md bg-neutral-900 px-6 py-3 font-medium text-white dark:bg-white dark:text-neutral-900"
            >
              Sign in and try it
            </Link>
            <Link
              href="/pricing"
              className="rounded-md border border-neutral-300 px-6 py-3 font-medium dark:border-neutral-700"
            >
              See pricing
            </Link>
          </div>
        </section>
        <section className="grid w-full divide-y divide-neutral-200 border-y border-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-neutral-800 dark:border-neutral-800">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="px-6 py-6">
              <b className="mb-1.5 block font-semibold">{feature.title}</b>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {feature.detail}
              </span>
            </div>
          ))}
        </section>
    </Shell>
  );
}
