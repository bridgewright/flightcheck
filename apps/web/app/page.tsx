import Link from "next/link";

import Shell from "@/components/Shell";
import { getViewer } from "@/lib/viewer";

const FEATURES: {
  title: string;
  detail: string;
  link?: { href: string; label: string };
}[] = [
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
    link: { href: "/sample-report", label: "See a real report →" },
  },
];

// The same capture the README opens with (docs/demo.gif, copied into public/
// so the app serves its own asset): intake, the cited rubric, the session
// room, the report verdict. Plain <img> on purpose — next/image would route
// the file through the optimizer, which drops GIF animation. width/height are
// the file's real pixels (not 16:9), so the browser reserves the right box
// and the frames are never cropped.
function DemoClip() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="h-auto w-full rounded-md border border-neutral-300 dark:border-neutral-700"
      src="/demo.gif"
      alt="flightcheck demo: paste a JD, preview the cited rubric, take the voice interview, read the honest report"
      width={960}
      height={450}
    />
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
          <DemoClip />
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
          {viewer ? (
            <p className="mt-6 text-sm">
              <Link href="/home" className="underline underline-offset-4">
                You&apos;re signed in — go to your home →
              </Link>
            </p>
          ) : null}
        </section>
        <section className="grid w-full divide-y divide-neutral-200 border-y border-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-neutral-800 dark:border-neutral-800">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="px-6 py-6">
              <b className="mb-1.5 block font-semibold">{feature.title}</b>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">
                {feature.detail}
              </span>
              {feature.link ? (
                <Link
                  href={feature.link.href}
                  className="mt-2.5 block text-sm underline underline-offset-4"
                >
                  {feature.link.label}
                </Link>
              ) : null}
            </div>
          ))}
        </section>
    </Shell>
  );
}
