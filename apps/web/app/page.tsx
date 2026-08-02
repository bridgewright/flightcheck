import Link from "next/link";

import TopBar from "@/components/TopBar";
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
        className="aspect-video w-full rounded-2xl border border-line shadow-[0_2px_6px_rgba(0,0,0,.35),0_18px_48px_rgba(0,0,0,.45)]"
        src={DEMO_VIDEO_URL}
        controls
        preload="metadata"
      />
    );
  }
  return (
    <div className="relative flex aspect-video w-full items-center justify-center rounded-2xl border border-line bg-[linear-gradient(165deg,var(--color-night-2)_0%,var(--color-night-1)_55%,#1a2544_100%)] shadow-[0_2px_6px_rgba(0,0,0,.35),0_18px_48px_rgba(0,0,0,.45)]">
      <span
        aria-hidden="true"
        className="flex size-17 items-center justify-center rounded-full border border-line bg-night-0/60"
      >
        <span className="ml-1.5 border-y-[12px] border-l-[20px] border-y-transparent border-l-faint" />
      </span>
      <span className="absolute bottom-3.5 left-4 text-xs text-muted">
        Demo video — coming soon
      </span>
    </div>
  );
}

function RunwayLights() {
  return (
    <div aria-hidden="true" className="flex justify-center gap-2.5">
      {Array.from({ length: 10 }, (_, i) => (
        <i
          key={i}
          className={`size-1.5 rounded-full bg-amber ${i % 2 ? "opacity-40" : ""}`}
        />
      ))}
    </div>
  );
}

export default async function LandingPage() {
  const viewer = await getViewer();
  return (
    <>
      <TopBar viewer={viewer} />
      <main className="flex flex-col">
        <section className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-16 pb-14 text-center">
          <h1 className="font-display text-[33px] leading-[1.14] font-[480] text-balance md:text-[46px]">
            Would you pass the interview <em className="text-coral">today?</em>
          </h1>
          <p className="mx-auto mt-4 mb-8 max-w-xl text-[16.5px] text-muted">
            Paste the job description you&apos;re facing. A live interviewer holds you
            to that role&apos;s real bar — in English, out loud — and tells you honestly
            what&apos;s still missing. Repeat until you&apos;d pass.
          </p>
          <DemoVideo />
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="rounded-[10px] bg-coral px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#c96a4a]"
            >
              Sign in and try it
            </Link>
            <Link
              href="/pricing"
              className="rounded-[10px] border border-line px-6 py-3 text-[15px] font-semibold text-ink transition-colors hover:border-faint"
            >
              See pricing
            </Link>
          </div>
          <div className="mt-9">
            <RunwayLights />
          </div>
        </section>
        <section className="mx-auto grid w-full max-w-5xl gap-px border-y border-line bg-line sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-night-0 px-6 py-6">
              <b className="mb-1.5 block text-sm font-semibold">{feature.title}</b>
              <span className="text-[13px] text-muted">{feature.detail}</span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
