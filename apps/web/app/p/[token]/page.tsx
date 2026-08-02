import { headers } from "next/headers";
import Link from "next/link";

import JourneyStrip from "@/components/JourneyStrip";
import PollRefresh from "@/components/PollRefresh";
import ReadinessGauge from "@/components/ReadinessGauge";
import SessionList from "@/components/SessionList";
import SessionTicket from "@/components/SessionTicket";
import Shell from "@/components/Shell";
import StartSessionButton from "@/components/StartSessionButton";
import { journeyLegs, nextSessionNumber, verdictLine } from "@/lib/home";
import type { PackageRow, Rubric, Verdict } from "@/lib/types";
import { PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import type { SessionSummary } from "@/lib/worker";
import {
  getPackageByToken,
  getSession,
  listSessions,
  packageOwnerId,
  packageTotalSessions,
} from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Claims the package for the signed-in viewer the first time they open its
 * link. Awaited rather than fired and forgotten: on a serverless runtime a
 * dangling promise can be cut off when the response finishes, and the whole
 * point is that the package appears on /home afterwards.
 *
 * The cookie is forwarded so the route can resolve the same session; it
 * re-reads the identity itself and never trusts anything sent here.
 */
async function bindToViewer(token: string): Promise<void> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) {
    return;
  }
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  await fetch(`${proto}://${host}/api/packages/bind`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: requestHeaders.get("cookie") ?? "",
    },
    body: JSON.stringify({ token }),
  }).catch(() => {
    // Binding is a convenience; the package page works either way.
  });
}

interface LastOutcome {
  headline: ReturnType<typeof verdictLine>;
  verdict: Verdict | null;
  overall: number | null;
}

async function lastOutcome(
  sessions: SessionSummary[],
  rubric: Rubric,
): Promise<LastOutcome> {
  const latest = sessions
    .filter((session) => session.status === "scored")
    .sort((a, b) => b.index - a.index)[0];
  if (!latest) {
    return { headline: null, verdict: null, overall: null };
  }
  const session = await getSession(latest.id).catch(() => null);
  const names = Object.fromEntries(rubric.dimensions.map((d) => [d.key, d.name]));
  const report = session?.report ?? null;
  return {
    headline: verdictLine(report, names),
    verdict: report?.verdict ?? null,
    overall: report?.overall_score ?? latest.overall,
  };
}

export default async function PackagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const viewer = await getViewer();
  let pkg: PackageRow;
  try {
    pkg = await getPackageByToken(token);
  } catch {
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col gap-3 py-16">
          <h1 className="text-2xl font-bold tracking-tight">Package not found</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            This link does not match any interview package. Check the URL, or{" "}
            <Link href="/new" className="underline underline-offset-4">
              start a new one
            </Link>
            .
          </p>
        </div>
      </Shell>
    );
  }

  // An authenticated visit to a package nobody owns claims it.
  if (viewer && packageOwnerId(pkg) === null) {
    await bindToViewer(token);
  }

  if (pkg.status === "compiling") {
    return (
      <Shell viewer={viewer}>
        <PollRefresh intervalMs={3000} />
        <div className="flex flex-col gap-3 py-16">
          <h1 className="text-2xl font-bold tracking-tight">Compiling your rubric&hellip;</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            We are reading the JD, researching how this role actually interviews, and
            compiling your rubric. This page refreshes itself — usually 1&ndash;2
            minutes.
          </p>
        </div>
      </Shell>
    );
  }

  if (pkg.status === "failed" || !pkg.rubric) {
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col gap-3 py-16">
          <h1 className="text-2xl font-bold tracking-tight">We could not compile this package</h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Rubric compilation failed — most often because the JD page could not be
            read. No charge, nothing saved.{" "}
            <Link href="/new" className="underline underline-offset-4">
              Try again
            </Link>{" "}
            with the JD pasted as text instead of a URL.
          </p>
        </div>
      </Shell>
    );
  }

  const rubric = pkg.rubric;
  const total = packageTotalSessions(pkg);
  const sessions = await listSessions(pkg.id).catch(() => [] as SessionSummary[]);
  const legs = journeyLegs(sessions, total);
  const next = nextSessionNumber(sessions, total);
  const done = legs.filter((leg) => leg === "done").length;
  const outcome = await lastOutcome(sessions, rubric);

  return (
    <Shell viewer={viewer}>
      <h1 className="text-center text-2xl font-bold tracking-tight text-balance">
        {rubric.role_title}
      </h1>
      <p className="mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        {rubric.company ? `${rubric.company} · ` : ""}
        {done} of {total} sessions done
      </p>

      <div className="mb-7">
        <JourneyStrip legs={legs} />
      </div>

      <SessionTicket
        sessionNumber={next}
        totalSessions={total}
        verdict={outcome.headline}
        action={
          next === null ? (
            <Link href="/pricing" className={PRIMARY_BUTTON}>
              See pricing
            </Link>
          ) : (
            <StartSessionButton packageId={pkg.id} token={token} />
          )
        }
      />

      <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_168px] sm:items-start">
        <SessionList sessions={sessions} token={token} />
        <ReadinessGauge score={outcome.overall} verdict={outcome.verdict} />
      </div>

      {/* The rubric is why the verdicts mean anything, but it is reference
          material — it opens when the user wants it, not every visit. */}
      <details className="group mt-9 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="text-[10px] transition-transform group-open:rotate-90"
          >
            ▶
          </span>
          What this role evaluates — the {rubric.dimensions.length} dimensions of your
          rubric
        </summary>
        <ol className="mt-5 flex flex-col gap-6">
          {rubric.dimensions.map((dimension) => (
            <li key={dimension.key} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-semibold">{dimension.name}</h2>
                <span className="text-xs text-neutral-500">
                  {Math.round(dimension.weight * 100)}% of your score
                </span>
              </div>
              <ul className="list-disc pl-5 text-sm text-neutral-600 dark:text-neutral-400">
                {dimension.signals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
              <p className="text-xs text-neutral-500">
                Sources:{" "}
                {dimension.citations.map((citation, i) => (
                  <span key={citation.url}>
                    {i > 0 ? " · " : ""}
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {citation.title}
                    </a>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ol>
      </details>
    </Shell>
  );
}
