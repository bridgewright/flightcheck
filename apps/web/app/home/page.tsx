import { cookies } from "next/headers";
import Link from "next/link";

import JourneyStrip from "@/components/JourneyStrip";
import PollRefresh from "@/components/PollRefresh";
import ReadinessGauge from "@/components/ReadinessGauge";
import SessionList from "@/components/SessionList";
import SessionTicket from "@/components/SessionTicket";
import Shell from "@/components/Shell";
import StartSessionButton from "@/components/StartSessionButton";
import { resolveActivePackage } from "@/lib/active-package";
import type { VerdictLine } from "@/lib/home";
import {
  ACTIVE_PACKAGE_COOKIE,
  greetingName,
  journeyLegs,
  nextSessionNumber,
  packageDisplayTitle,
  scoringStageLine,
  verdictLine,
} from "@/lib/home";
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
    <Shell viewer={null} path="/home">
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

// packages={[]} on purpose: the worker is down, so the TopBar must not try a
// second fetch of its own for the switcher.
function Unreachable({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer} path="/home" packages={[]}>
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
    <Shell viewer={viewer} path="/home" packages={[]}>
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
  active: PackageSummary,
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
    getPackageByToken(active.access_token).catch(() => null),
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

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ pkg?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) {
    return <SignedOut />;
  }

  // Which package this dashboard is about: ?pkg= query > fc_pkg cookie >
  // newest owned. The /switch route owns writing the cookie; here both are
  // only hints resolved against the viewer's own packages.
  const { pkg: pkgParam } = await searchParams;
  const cookieStore = await cookies();
  let packages: PackageSummary[];
  let sessions: SessionSummary[];
  let active: PackageSummary | null;
  try {
    packages = await listPackagesForUser(viewer.id);
    active = resolveActivePackage(
      packages,
      typeof pkgParam === "string" ? pkgParam : null,
      cookieStore.get(ACTIVE_PACKAGE_COOKIE)?.value ?? null,
    );
    sessions = active ? await listSessions(active.id) : [];
  } catch {
    return <Unreachable viewer={viewer} />;
  }
  if (!active) {
    return <NoPackages viewer={viewer} />;
  }

  const total = active.total_sessions;
  const legs = journeyLegs(sessions, total);
  const next = nextSessionNumber(sessions, total);
  const done = legs.filter((leg) => leg === "done").length;
  const stageLine = scoringStageLine(sessions);
  const outcome = await lastOutcome(active, sessions);

  return (
    <Shell viewer={viewer} path="/home" packages={packages} activePackageId={active.id}>
      {/* While a session is being scored the stage line advances on its own. */}
      {stageLine !== null ? <PollRefresh intervalMs={5000} /> : null}
      <h1 className="text-center text-2xl font-bold tracking-tight text-balance">
        {greetingName(viewer.email)}
      </h1>
      <p className="mb-6 text-center text-sm text-neutral-600 dark:text-neutral-400">
        {packageDisplayTitle(active.role_title)} · {done} of {total} sessions
        done
      </p>

      <div className="mb-7">
        <JourneyStrip legs={legs} />
      </div>

      <SessionTicket
        sessionNumber={next}
        totalSessions={total}
        verdict={outcome.line}
        stageLine={stageLine}
        action={
          next === null ? (
            <Link href="/pricing" className={PRIMARY_BUTTON}>
              See pricing
            </Link>
          ) : (
            <StartSessionButton
              packageId={active.id}
              token={active.access_token}
              label={`Start session ${next}`}
            />
          )
        }
      />

      <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_168px] sm:items-start">
        <SessionList sessions={sessions} />
        <ReadinessGauge score={outcome.overall} verdict={outcome.verdict} />
      </div>

      {/* The switcher in the TopBar replaced the old package list here; one
          quiet link remains for the overview screen. */}
      <p className="mt-9 border-t border-neutral-200 pt-5 text-sm dark:border-neutral-800">
        <Link href="/packages" className="underline underline-offset-4">
          All packages
        </Link>
      </p>
    </Shell>
  );
}
