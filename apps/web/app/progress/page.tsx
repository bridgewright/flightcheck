import { cookies } from "next/headers";
import Link from "next/link";

import { packageIdentityDecision } from "@/components/package-identity";
import PackageIdentity from "@/components/PackageIdentity";
import PollRefresh from "@/components/PollRefresh";
import ProgressDeliveryTable from "@/components/ProgressDeliveryTable";
import ProgressDimensionTable from "@/components/ProgressDimensionTable";
import ProgressFocus from "@/components/ProgressFocus";
import ProgressTrajectory from "@/components/ProgressTrajectory";
import { dimensionMeta, scoredInOrder } from "@/components/progress-view";
import ReadinessGauge from "@/components/ReadinessGauge";
import Shell from "@/components/Shell";
import StartSessionButton from "@/components/StartSessionButton";
import { resolveActivePackage } from "@/lib/active-package";
import { nextSessionNumber } from "@/lib/home";
import { dimensionTrends, recurringIssues } from "@/lib/progress";
import { FINE_PRINT, PAGE_HEADING, PRIMARY_BUTTON, SUBTLE } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageProgress, PackageSummary, SessionSummary } from "@/lib/worker";
import {
  getPackageByToken,
  getPackageProgress,
  listPackagesForUser,
  listSessions,
} from "@/lib/worker";

export const dynamic = "force-dynamic";

// Fallback for when the proxy guard did not already send a signed-out
// visitor to /login — a silent empty page would look broken, not gated.
function SignedOut() {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          You need to sign in to see your progress.
        </h1>
        <Link href="/login?next=/progress" className={PRIMARY_BUTTON}>
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
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Can&apos;t reach your progress right now.
        </h1>
        <p className={`${SUBTLE} max-w-md`}>
          Your sessions are safe. The service that holds them is briefly
          unreachable, most often during a restart. This page retries by
          itself; leave it open.
        </p>
      </div>
    </Shell>
  );
}

function NoPackages({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer}>
      <div className="flex flex-col items-center gap-5 py-14 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Progress starts with a package.
        </h1>
        <p className="max-w-md text-ink-muted">
          Paste the job description you&apos;re applying to, run your sessions, and
          this page tracks how your readiness moves between them.
        </p>
        <Link href="/new" className={PRIMARY_BUTTON}>
          Start with a job description
        </Link>
      </div>
    </Shell>
  );
}

function Heading({
  pkg,
  scoredCount,
}: {
  pkg: PackageSummary;
  scoredCount: number;
}) {
  // The employer chip (F-56). With a company the subtitle is a one-line flex
  // row: chip first, a long title truncates, the scored counter stays whole.
  // Without one the branch keeps the original markup byte for byte. The
  // branch key is the same decision PackageIdentity itself consults.
  const identity = packageIdentityDecision(pkg.company, pkg.jd_url);
  return (
    <>
      <h1 className={`${PAGE_HEADING} text-center text-balance`}>
        Your progress
      </h1>
      {identity === null ? (
        <p className={`${SUBTLE} mb-6 text-center`}>
          {pkg.role_title ?? "Your interview package"} · {scoredCount} of{" "}
          {pkg.total_sessions} sessions scored
        </p>
      ) : (
        <p className={`${SUBTLE} mb-6 flex items-center justify-center gap-1.5`}>
          <PackageIdentity
            packageId={pkg.id}
            company={pkg.company}
            jdUrl={pkg.jd_url}
            variant="chip"
          />
          <span className="min-w-0 truncate">
            {pkg.role_title ?? "Your interview package"}
          </span>
          <span className="whitespace-nowrap">
            · {scoredCount} of {pkg.total_sessions} sessions scored
          </span>
        </p>
      )}
    </>
  );
}

// The one primary action: the same start flow home uses. When the package is
// spent there is nothing to start, and the trajectory already says so.
function StartCta({
  pkg,
  next,
}: {
  pkg: PackageSummary;
  next: number | null;
}) {
  if (next === null) {
    return (
      <p className={`${FINE_PRINT} mt-9 text-center`}>
        All {pkg.total_sessions} sessions used.
      </p>
    );
  }
  return (
    <div className="mt-9 flex justify-center">
      <StartSessionButton
        packageId={pkg.id}
        label={`Start session ${next}`}
      />
    </div>
  );
}

// The worker's progress endpoint failed but the plain session list did not:
// show the latest score honestly and keep retrying for the trends.
function PartialProgress({
  viewer,
  pkg,
  sessions,
}: {
  viewer: Viewer;
  pkg: PackageSummary;
  sessions: SessionSummary[];
}) {
  const scored = sessions
    .filter((session) => session.status === "scored")
    .sort((a, b) => a.index - b.index);
  const latest = scored[scored.length - 1];
  return (
    <Shell viewer={viewer}>
      <PollRefresh intervalMs={5000} />
      <Heading pkg={pkg} scoredCount={scored.length} />
      <div className="mt-8 flex flex-col items-center gap-4">
        <ReadinessGauge
          score={latest?.overall ?? null}
          verdict={latest?.verdict ?? null}
        />
        <p className={`${SUBTLE} max-w-md text-center`}>
          Trend data is briefly unreachable, so this shows your latest score
          only. This page retries by itself; leave it open.
        </p>
      </div>
      <StartCta pkg={pkg} next={nextSessionNumber(sessions, pkg.total_sessions)} />
    </Shell>
  );
}

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const viewer = await getViewer();
  if (!viewer) {
    return <SignedOut />;
  }

  let packages: PackageSummary[];
  try {
    packages = await listPackagesForUser(viewer.id);
  } catch {
    return <Unreachable viewer={viewer} />;
  }
  const pkgParam = (await searchParams).pkg;
  const cookieStore = await cookies();
  const active = resolveActivePackage(
    packages,
    Array.isArray(pkgParam) ? pkgParam[0] : pkgParam,
    cookieStore.get("fc_pkg")?.value,
  );
  if (!active) {
    return <NoPackages viewer={viewer} />;
  }

  // The rubric ride-along is best-effort: it only improves labels (dimension
  // names and channel tags), so its failure must never take the screen down.
  const [progress, pkgRow] = await Promise.all([
    getPackageProgress(active.id).catch(() => null as PackageProgress | null),
    getPackageByToken(active.access_token).catch(() => null),
  ]);
  if (progress === null) {
    let sessions: SessionSummary[];
    try {
      sessions = await listSessions(active.id);
    } catch {
      return <Unreachable viewer={viewer} />;
    }
    return <PartialProgress viewer={viewer} pkg={active} sessions={sessions} />;
  }

  const entries = progress.sessions;
  const scored = scoredInOrder(entries);
  const latest = scored[scored.length - 1];
  const next = nextSessionNumber(entries, active.total_sessions);
  const meta = dimensionMeta(pkgRow?.rubric ?? null);

  return (
    <Shell viewer={viewer}>
      <Heading pkg={active} scoredCount={scored.length} />
      <ProgressTrajectory entries={entries} totalSessions={active.total_sessions} />
      {scored.length < 2 ? (
        <div className="mt-8 flex flex-col items-center gap-4">
          <ReadinessGauge
            score={latest?.overall ?? null}
            verdict={latest?.verdict ?? null}
          />
          <p className={`${SUBTLE} max-w-md text-center`}>
            {scored.length === 0
              ? "Your first scored session sets the baseline. Trends need two."
              : "Trends appear after your second scored session."}
          </p>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <ProgressDimensionTable
            trends={dimensionTrends(entries)}
            meta={meta}
            totalSlots={active.total_sessions}
          />
          <ProgressDeliveryTable scored={scored} />
          <ProgressFocus
            entries={entries}
            issues={recurringIssues(entries)}
            meta={meta}
          />
        </div>
      )}
      <StartCta pkg={active} next={next} />
    </Shell>
  );
}
