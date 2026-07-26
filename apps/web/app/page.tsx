import Link from "next/link";

const FEATURES = [
  {
    title: "JD-grounded rubric with cited sources",
    detail:
      "Every dimension you are scored on is compiled from the job description and live research, with citations you can open.",
  },
  {
    title: "Real voice interview, not a chatbot",
    detail:
      "A 20-minute spoken session with an interviewer that probes for specifics — no typing, no canned scripts.",
  },
  {
    title: "Delivery diagnosed from your actual audio",
    detail:
      "Pace, fillers, silences, and response latency are measured from the recording — not guessed from a transcript.",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-12 px-6 py-16">
      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Know if you&apos;d pass &mdash; before you interview.
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-300">
          JD-specific mock interviews with honest verdicts, built for non-native English
          speakers interviewing for global roles.
        </p>
      </section>
      <ul className="flex flex-col gap-5">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="flex flex-col gap-1">
            <span className="font-semibold">{feature.title}</span>
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              {feature.detail}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/new"
          className="rounded-md bg-neutral-900 px-6 py-3 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Start
        </Link>
        <Link href="/sample-report" className="font-medium underline underline-offset-4">
          Try the sample report
        </Link>
      </div>
      <p className="text-sm text-neutral-500">
        flightcheck is built to be honest: when the evidence says you are not ready yet, the
        report says &quot;not yet&quot; &mdash; and shows you exactly what to fix.
      </p>
    </main>
  );
}
