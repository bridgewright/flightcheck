import { cookies } from "next/headers";
import Link from "next/link";

import JourneyStrip from "@/components/JourneyStrip";
import HomeTour from "@/components/HomeTour";
import { packageIdentityDecision } from "@/components/package-identity";
import PackageIdentity from "@/components/PackageIdentity";
import PollRefresh from "@/components/PollRefresh";
import OverallTrend from "@/components/OverallTrend";
import ProgressDimensionTable from "@/components/ProgressDimensionTable";
import ProgressFocus from "@/components/ProgressFocus";
import ReadinessGauge from "@/components/ReadinessGauge";
import ReclaimSessionButton from "@/components/ReclaimSessionButton";
import RedeemCode from "@/components/redeem-code";
import RetryCompileButton from "@/components/RetryCompileButton";
import SessionList from "@/components/SessionList";
import SessionTicket from "@/components/SessionTicket";
import Shell from "@/components/Shell";
import StartSessionButton from "@/components/StartSessionButton";
import { trendSectionVisible } from "@/components/home-dashboard";
import { dimensionMeta } from "@/components/progress-view";
import { retryCompileAction } from "@/app/packages/actions";
import { resolveActivePackage } from "@/lib/active-package";
import { cbtEntitlementCopy } from "@/lib/cbt";
import type { VerdictLine } from "@/lib/home";
import {
  ACTIVE_PACKAGE_COOKIE,
  checkoutHref,
  effectiveTotalSessions,
  isUnpaid,
  expiryLine,
  greetingName,
  journeyLegs,
  nextSessionNumber,
  packageDisplayTitle,
  scoringStageLine,
  unlockCtaLabel,
  verdictLine,
} from "@/lib/home";
import type { Verdict } from "@/lib/types";
import type { CbtStatus, Rubric } from "@/lib/types";
import { dimensionTrends, recurringIssues } from "@/lib/progress";
import { CARD, DIVIDER, FINE_PRINT, LABEL, PAGE_HEADING, PRIMARY_BUTTON, LINK, SUBTLE } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary, SessionSummary } from "@/lib/worker";
import { getPackageByToken, getPackageProgress, getPackagesForUser, getSession, listSessions } from "@/lib/worker";

export const dynamic = "force-dynamic";

// Normally the proxy guard redirects a signed-out visitor to /login before this
// renders. This is the fallback for when it does not — a page that quietly
// showed nothing would look broken rather than gated.
function SignedOut() {
  return (
    <Shell viewer={null} path="/home">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
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
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Can&apos;t reach your sessions right now.
        </h1>
        <p className={`${SUBTLE} max-w-md`}>
          Your account is fine. The service that holds your packages is briefly
          unreachable, most often during a restart. This page retries by itself;
          leave it open.
        </p>
      </div>
    </Shell>
  );
}

function NoPackages({ viewer, cbt }: { viewer: Viewer; cbt: CbtStatus | null }) {
  const entitlement = cbt === null ? null : cbtEntitlementCopy(cbt);
  return (
    <Shell viewer={viewer} path="/home" packages={[]}>
      <HomeTour />
      <div className="flex flex-col items-center gap-5 py-14 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          {greetingName(viewer.email)}
        </h1>
        <p className="max-w-md text-ink-muted">
          Paste the job description you&apos;re applying to and your rubric is
          ready in about two minutes.
        </p>
        <Link href="/new" className={PRIMARY_BUTTON}>
          Start with a job description
        </Link>
        {entitlement ? <p className={SUBTLE}>{entitlement}</p> : null}
        {cbt === null ? <RedeemCode /> : null}
      </div>
    </Shell>
  );
}

interface LastOutcome {
  line: VerdictLine | null;
  verdict: Verdict | null;
  overall: number | null;
  rubric: Rubric | null;
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
  const empty: LastOutcome = { line: null, verdict: null, overall: null, rubric: null };
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
    rubric: pkg?.rubric ?? null,
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
  let cbt: CbtStatus | null;
  let sessions: SessionSummary[];
  let active: PackageSummary | null;
  try {
    const response = await getPackagesForUser(viewer.id);
    packages = response.packages;
    cbt = response.cbt;
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
    return <NoPackages viewer={viewer} cbt={cbt} />;
  }

  // The employer chip (F-56). When the rubric named a company the subtitle
  // becomes a one-line flex row: the chip leads, a long title truncates, and
  // the session counter stays whole. When it named none, the branch keeps
  // the line's original markup byte for byte, so nothing shifts. The branch
  // key is the same decision PackageIdentity itself consults.
  const identity = packageIdentityDecision(active.company, active.jd_url);

  // A failed compile has no rubric, so the journey strip and the session
  // ticket would be theater — the honest screen is the failure, a retry,
  // and a way out.
  if (active.status === "failed") {
    return (
      <Shell viewer={viewer} path="/home" packages={packages} activePackageId={active.id}>
        <h1 className={`${PAGE_HEADING} text-center text-balance`}>
          {greetingName(viewer.email)}
        </h1>
        {identity === null ? (
          <p className={`${SUBTLE} mb-6 text-center`}>
            {packageDisplayTitle(active.role_title)}
          </p>
        ) : (
          <p className={`${SUBTLE} mb-6 flex items-center justify-center gap-1.5`}>
            <PackageIdentity
              packageId={active.id}
              company={active.company}
              jdUrl={active.jd_url}
              variant="chip"
            />
            <span className="min-w-0 truncate">
              {packageDisplayTitle(active.role_title)}
            </span>
          </p>
        )}
        <article className={CARD}>
          <div className="flex flex-col gap-3 px-5 py-5">
            <div className={LABEL}>Compile failed</div>
            <p className={SUBTLE}>
              The rubric for this package didn&apos;t compile, most often
              because the JD page couldn&apos;t be read. Retry the compile, or
              start over with the JD pasted as text.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <RetryCompileButton packageId={active.id} action={retryCompileAction} />
              <Link href="/new" className={`${LINK} ${SUBTLE}`}>
                Start over with a new JD
              </Link>
            </div>
          </div>
        </article>
        <p className={`mt-9 border-t pt-5 text-fine ${DIVIDER}`}>
          <Link href="/packages" className={LINK}>
            All packages
          </Link>
        </p>
      </Shell>
    );
  }

  // The effective quota is the UI chokepoint of the trial model: an unpaid
  // package renders "of 1", never "of 6" — no surface promises sessions the
  // user has not bought.
  const total = effectiveTotalSessions(active);
  const legs = journeyLegs(sessions, total);
  const next = nextSessionNumber(sessions, total);
  const done = legs.filter((leg) => leg === "done").length;
  const stageLine = scoringStageLine(sessions);
  const [outcome, progress] = await Promise.all([
    lastOutcome(active, sessions),
    getPackageProgress(active.id).catch(() => null),
  ]);
  const unpaid = isUnpaid(active);
  const expiry = expiryLine(active, new Date());
  const dropped = sessions.find((session) => session.stopped_reporting === true);

  return (
    <Shell viewer={viewer} path="/home" packages={packages} activePackageId={active.id}>
      <HomeTour />
      {/* While a session is being scored the stage line advances on its own. */}
      {stageLine !== null ? <PollRefresh intervalMs={5000} /> : null}
      <h1 className={`${PAGE_HEADING} text-center text-balance`}>
        {greetingName(viewer.email)}
      </h1>
      {identity === null ? (
        <p
          className={`${SUBTLE} ${expiry === null ? "mb-6" : "mb-1.5"} text-center`}
        >
          {packageDisplayTitle(active.role_title)} · {done} of {total} sessions
          done
        </p>
      ) : (
        <p
          className={`${SUBTLE} ${expiry === null ? "mb-6" : "mb-1.5"} flex items-center justify-center gap-1.5`}
        >
          <PackageIdentity
            packageId={active.id}
            company={active.company}
            jdUrl={active.jd_url}
            variant="chip"
          />
          <span className="min-w-0 truncate">
            {packageDisplayTitle(active.role_title)}
          </span>
          <span className="whitespace-nowrap">
            · {done} of {total} sessions done
          </span>
        </p>
      )}
      {expiry !== null ? (
        <p className={`${FINE_PRINT} mb-6 text-center`}>{expiry}</p>
      ) : null}

      <div className="mb-7">
        <JourneyStrip legs={legs} />
      </div>

      <div data-tour="primary-action">
        <SessionTicket
          sessionNumber={next}
          totalSessions={total}
          verdict={outcome.line}
          stageLine={stageLine}
          locked={unpaid}
          action={
            next === null ? (
              unpaid ? (
                // The unlock moment: same package, same JD — the payment only
                // lifts the session quota.
                <Link href={checkoutHref(active.id)} className={PRIMARY_BUTTON}>
                  {unlockCtaLabel()}
                </Link>
              ) : (
                <Link href="/pricing" className={PRIMARY_BUTTON}>
                  See pricing
                </Link>
              )
            ) : dropped ? (
              <ReclaimSessionButton sessionId={dropped.id} packageId={active.id} />
            ) : (
              <StartSessionButton
                packageId={active.id}
                label={`Start session ${next}`}
              />
            )
          }
        />
      </div>

      {progress !== null && trendSectionVisible(progress.sessions) ? (
        <section data-tour="progress" className="mt-8 flex flex-col gap-5">
          <h2 className={LABEL}>Progress so far</h2>
          <OverallTrend entries={progress.sessions} totalSlots={total} />
          <ProgressDimensionTable
            trends={dimensionTrends(progress.sessions)}
            meta={dimensionMeta(outcome.rubric)}
            totalSlots={total}
          />
          {(() => {
            // On the glance dashboard the recurring-focus block earns its
            // place only when something recurs; its explain-the-threshold
            // empty state belongs to /progress, not here.
            const issues = recurringIssues(progress.sessions);
            return issues.gaps.length > 0 || issues.weakDimensions.length > 0 ? (
              <ProgressFocus
                entries={progress.sessions}
                issues={issues}
                meta={dimensionMeta(outcome.rubric)}
              />
            ) : null;
          })()}
          <p className="text-fine">
            <Link href="/progress" className={LINK}>
              Full progress
            </Link>
          </p>
        </section>
      ) : null}

      <div className="mt-8 grid gap-6 sm:grid-cols-[1fr_168px] sm:items-start">
        <SessionList sessions={sessions} />
        <ReadinessGauge score={outcome.overall} verdict={outcome.verdict} />
      </div>

      {/* The switcher in the TopBar replaced the old package list here; one
          quiet link remains for the overview screen. */}
      <p className={`mt-9 border-t pt-5 text-fine ${DIVIDER}`}>
        <Link href="/packages" className={LINK}>
          All packages
        </Link>
      </p>
    </Shell>
  );
}
