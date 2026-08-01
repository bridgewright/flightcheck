import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import ReportView, { dimensionMetaFromRubric } from "@/components/ReportView";
import { scoringStageCopy } from "@/lib/report-format";
import { authorizeSession } from "@/lib/worker";

export const dynamic = "force-dynamic";

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-bold">Report not found</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        This link does not match any session report. Check the URL, or{" "}
        <Link href="/new" className="underline underline-offset-4">
          start a new package
        </Link>
        .
      </p>
    </main>
  );
}

function WorkerUnreachable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <PollRefresh intervalMs={5000} />
      <h1 className="text-2xl font-bold">Can&apos;t reach the scoring service</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Your link is fine — the scoring service is briefly unreachable, most
        often during a restart window. This page retries automatically;
        leave it open.
      </p>
    </main>
  );
}

export default async function SessionReportPage({
  params,
}: {
  params: Promise<{ token: string; id: string }>;
}) {
  const { token, id } = await params;
  // Ownership check: the access token is the only capability, so a session
  // id from another package must be indistinguishable from a missing one.
  const access = await authorizeSession(token, id);
  if (!access.ok) {
    return access.status === 502 ? <WorkerUnreachable /> : <NotFound />;
  }
  const { pkg, session } = access.value;

  if (session.status === "failed") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
        <h1 className="text-2xl font-bold">Scoring failed</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          We could not score this session — most often an unreadable recording. We show
          failures instead of papering over them. Your rubric is unaffected:{" "}
          <Link href={`/p/${token}`} className="underline underline-offset-4">
            return to your package
          </Link>{" "}
          and run a new session.
        </p>
      </main>
    );
  }

  if (session.status !== "scored" || !session.report) {
    // Known stages narrate the worker's progress; null/unknown stages keep
    // the generic line (older rows, or a newer worker than this build).
    const stageCopy = scoringStageCopy(session.scoring_stage);
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16">
        <PollRefresh intervalMs={3000} />
        <h1 className="text-2xl font-bold">Scoring your session&hellip;</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          {stageCopy ??
            "Transcription, delivery metrics, and dual-channel judging usually take a few minutes. This page refreshes itself."}
        </p>
      </main>
    );
  }

  const dimensions = pkg.rubric ? dimensionMetaFromRubric(pkg.rubric) : [];
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Session report</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          <Link href={`/p/${token}`} className="underline underline-offset-4">
            Back to your package
          </Link>
        </p>
      </header>
      <ReportView report={session.report} dimensions={dimensions} />
    </main>
  );
}
