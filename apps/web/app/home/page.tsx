import Link from "next/link";

import JourneyStrip from "@/components/JourneyStrip";
import PollRefresh from "@/components/PollRefresh";
import ReadinessGauge from "@/components/ReadinessGauge";
import SessionList from "@/components/SessionList";
import SessionTicket from "@/components/SessionTicket";
import Shell from "@/components/Shell";
import type { VerdictLine } from "@/lib/home";
import { greetingName, journeyLegs, nextSessionNumber, verdictLine } from "@/lib/home";
import type { Verdict } from "@/lib/types";
import { PRIMARY_BUTTON } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary, SessionSummary } from "@/lib/worker";
import { getPackageByToken, getSession, listPackagesForUser, listSessions } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Normally the proxy guard redirects a signed-out visitor to /login before this
// renders. This is the fallback for when it does not — a page that quietly
// showed nothing would look broken rather than gated.
function SignedOut() {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          You need to sign in to see your sessions.
        </h1>
        <Link href="/login?next=/home" className={PRIMARY_BUTTON}>
          Sign in
        </Link>
      </div>
    </Shell>
  );
}

function Unreachable({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer}>
      <PollRefresh intervalMs={5000} />
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Can&apos;t reach your sessions right now.
        </h1>
        <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-400">
          Your account is fine — the service that holds your packages is briefly
          unreachable, most often during a restart. This page retries by itself;
          leave it open.
        </p>
      </div>
    </Shell>
  );
}

function NoPackages({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col items-center gap-5 py-14 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          {greetingName(viewer.email)}
        </h1>
        <p className="max-w-md text-neutral-600 dark:text-neutral-400">
          Paste the job description you&apos;re applying to and your first session is
          ready in about two minutes.
        </p>
        <Link href="/new" className={PRIMARY_BUTTON}>
          Start with a job description
        </Link>
      </div>
    </Shell>
  );
}

interface LastOutcome {
  line: VerdictLine | null;
  verdict: Verdict | null;
  overall: number | null;
}

// The ticket's most valuable line is what the last report actually said, and
// the summaries deliberately do not carry reports. The newest scored session
// and the package (for the rubric's real dimension names) are fetched
// together; if either call fails the line is simply absent rather than the
// whole dashboard breaking.
async function lastOutcome(
  featured: PackageSummary,
  sessions: SessionSummary[],
): Promise<LastOutcome> {
  const empty: LastOutcome = { line: null, verdict: null, overall: null };
  const latest = sessions
    .filter((session) => session.status === "scored")
    .sort((a, b) => b.index - a.index)[0];
  if (!latest) {
    return empty;
  }
  const [session, pkg] = await Promise.all([
    getSession(latest.id).catch(() => null),
    getPackageByToken(featured.access_token).catch(() => null),
  ]);
  const names = Object.fromEntries(
    (pkg?.rubric?.dimensions ?? []).map((d) => [d.key, d.name]),
  );
  const report = session?.report ?? null;
  return {
    line: verdictLine(report, names),
    verdict: report?.verdict ?? null,
    overall: report?.overall_score ?? latest.overall,
  };
}

export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) {
    return <SignedOut />;
  }

  let packages: PackageSummary[];
  let sessions: SessionSummary[];
  // The worker returns them newest first; the newest one is what the user came
  // here to continue.
  let featured: PackageSummary | undefined;
  try {
    packages = await listPackagesForUser(viewer.id);
    featured = packages[0];
    sessions = featured ? await listSessions(featured.id) : [];
  } catch {
    return <Unreachable viewer={viewer} />;
  }
  if (!featured) {
    return <NoPackages viewer={viewer} />;
  }

  const total = featured.total_sessions;
  const legs = journeyLegs(sessions, total);
  const next = nextSessionNumber(sessions, total);
  const done = legs.filter((leg) => leg === "done").length;
  const outcome = await lastOutcome(featured, sessions);

  return (
    <Shell viewer={viewer}>
      <h1 className="text-center text-2xl font-bold tracking-tight text-balance">
        {greetingName(viewer.email)}
      </h1>
      <p className="mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        {featured.role_title ?? "Your interview package"} · {done} of {total} sessions
        done
      </p>

      <div className="mb-7">
        <JourneyStrip legs={legs} />
      </div>

      <SessionTicket
        sessionNumber={next}
        totalSessions={total}
        verdict={outcome.line}
        action={
          next === null ? (
            <Link href="/pricing" className={PRIMARY_BUTTON}>
              See pricing
            </Link>
          ) : (
            <Link href={`/p/${featured.access_token}`} className={PRIMARY_BUTTON}>
              Start session {next}
            </Link>
          )
        }
      />

      <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_168px] sm:items-start">
        <SessionList sessions={sessions} token={featured.access_token} />
        <ReadinessGauge score={outcome.overall} verdict={outcome.verdict} />
      </div>

      {packages.length > 1 ? (
        <section className="mt-9">
          <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Your other packages
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {packages.slice(1).map((pkg) => (
              <li key={pkg.id}>
                <Link
                  href={`/p/${pkg.access_token}`}
                  className="underline underline-offset-4"
                >
                  {pkg.role_title ?? "Untitled package"}
                </Link>
                <span className="ml-2 text-neutral-500">
                  {pkg.sessions_used} of {pkg.total_sessions} used
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Shell>
  );
}
