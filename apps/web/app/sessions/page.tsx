import { cookies } from "next/headers";
import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import Shell from "@/components/Shell";
import { resolveActivePackage } from "@/lib/active-package";
import { formatSessionDate } from "@/lib/home";
import {
  archiveStatusPill,
  formatDelta,
  overallDeltas,
  scoringStageCopy,
  VERDICT_LABELS,
  verdictPillClasses,
} from "@/lib/report-format";
import { EMPTY_RULE, PRIMARY_BUTTON, QUIET_LINK } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary, SessionSummary } from "@/lib/worker";
import { listPackagesForUser, listSessions } from "@/lib/worker";

export const dynamic = "force-dynamic";

// S7 — the session archive: every session the viewer has run (or still owes),
// each row linking to its detail page. The active package gets the full
// table; other packages appear as simplified groups below it.

function SignedOut() {
  return (
    <Shell viewer={null}>
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          You need to sign in to see your sessions.
        </h1>
        <Link href="/login?next=/sessions" className={PRIMARY_BUTTON}>
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
        <p className="max-w-md text-sm text-ink-muted">
          Your account is fine. The service that holds your sessions is briefly
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
          No sessions yet.
        </h1>
        <p className="max-w-md text-ink-muted">
          Sessions live inside an interview package. Paste the job description
          you&apos;re applying to and your first one is ready in about two minutes.
        </p>
        <Link href="/new" className={PRIMARY_BUTTON}>
          Start with a job description
        </Link>
      </div>
    </Shell>
  );
}

function VerdictCell({ session }: { session: SessionSummary }) {
  const pill = archiveStatusPill(session.status);
  if (pill === null) {
    // Scored: the verdict is the status. Older scored rows may predate the
    // summary's verdict column — the number still speaks below.
    return session.verdict ? (
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${verdictPillClasses(session.verdict)}`}
      >
        {VERDICT_LABELS[session.verdict]}
      </span>
    ) : (
      <span className="text-ink-faint">Scored</span>
    );
  }
  const stage =
    session.status === "scoring" ? scoringStageCopy(session.scoring_stage) : null;
  return (
    <span className="inline-flex flex-col gap-1">
      <span
        className={`inline-flex self-start rounded-full px-2.5 py-0.5 text-[11px] font-medium ${pill.className}`}
      >
        {pill.label}
      </span>
      {stage ? <span className="text-xs text-ink-faint">{stage}</span> : null}
    </span>
  );
}

function RowLinks({ session }: { session: SessionSummary }) {
  const detail = (label: string) => (
    <Link
      href={`/sessions/${session.id}`}
      className={`${QUIET_LINK} text-xs`}
    >
      {label}
    </Link>
  );
  if (session.status === "failed" || session.status === "insufficient") {
    // Both statuses are retriable the same way (F-04: insufficient is terminal
    // like failed, slot preserved): Retry enters this session's OWN room — the
    // slot is resumed, not burned.
    return (
      <span className="flex gap-3">
        {detail("View")}
        <Link
          href={`/sessions/${session.id}/room`}
          className={`${QUIET_LINK} text-xs`}
        >
          Retry
        </Link>
      </span>
    );
  }
  return detail(session.status === "scored" ? "Report" : "View");
}

const CELL = "py-3 pr-4 align-top";

function ArchiveTable({ sessions }: { sessions: SessionSummary[] }) {
  const ascending = [...sessions].sort((a, b) => a.index - b.index);
  const deltas = overallDeltas(sessions);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs tracking-wide text-ink-faint uppercase">
            <th className="py-2 pr-4 font-semibold">#</th>
            <th className="py-2 pr-4 font-semibold">Date</th>
            <th className="py-2 pr-4 font-semibold">Outcome</th>
            <th className="py-2 pr-4 font-semibold">Overall</th>
            <th className="py-2 pr-4 font-semibold">
              <abbr title="Change vs your previous scored session" className="no-underline">
                Δ
              </abbr>
            </th>
            <th className="py-2 font-semibold">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ascending.map((session) => {
            const delta = deltas.get(session.id);
            return (
              <tr
                key={session.id}
                className="border-b border-hairline"
              >
                <td className={`${CELL} text-xs text-ink-faint tabular-nums`}>
                  {String(session.index).padStart(2, "0")}
                </td>
                <td className={`${CELL} whitespace-nowrap text-ink-muted`}>
                  {formatSessionDate(session.created_at) ?? (
                    <span className={EMPTY_RULE} aria-hidden="true" />
                  )}
                </td>
                <td className={CELL}>
                  <VerdictCell session={session} />
                </td>
                <td className={`${CELL} font-semibold tabular-nums`}>
                  {session.overall === null ? (
                    <span className={EMPTY_RULE} aria-hidden="true" />
                  ) : (
                    session.overall.toFixed(1)
                  )}
                </td>
                <td className={`${CELL} text-ink-faint tabular-nums`}>
                  {delta === undefined ? (
                    <span className={EMPTY_RULE} aria-hidden="true" />
                  ) : (
                    formatDelta(delta)
                  )}
                </td>
                <td className="py-3 align-top">
                  <RowLinks session={session} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Other packages get date/outcome/overall only: the full table's delta column
// compares sessions within one rubric, and per-dimension context lives on the
// detail pages — cross-package rows carry just what is comparable.
function PackageGroup({
  pkg,
  sessions,
}: {
  pkg: PackageSummary;
  sessions: SessionSummary[] | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {pkg.role_title ?? "Untitled package"}
        <span className="ml-2 font-normal text-ink-faint">
          {pkg.sessions_used} of {pkg.total_sessions} used
        </span>
      </h3>
      {sessions === null ? (
        <p className="text-sm text-ink-muted">
          Couldn&apos;t load this package&apos;s sessions right now.
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No sessions in this package yet.
        </p>
      ) : (
        <ul>
          {[...sessions]
            .sort((a, b) => a.index - b.index)
            .map((session) => (
              <li
                key={session.id}
                className="grid grid-cols-[7rem_1fr_auto_auto] items-baseline gap-3.5 border-b border-hairline py-2.5 text-sm"
              >
                <span className="text-ink-muted">
                  {formatSessionDate(session.created_at) ?? (
                    <span className={EMPTY_RULE} aria-hidden="true" />
                  )}
                </span>
                <VerdictCell session={session} />
                <span className="font-semibold tabular-nums">
                  {session.overall === null ? (
                    <span className={EMPTY_RULE} aria-hidden="true" />
                  ) : (
                    session.overall.toFixed(1)
                  )}
                </span>
                <RowLinks session={session} />
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

export default async function SessionsPage({
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
  if (packages.length === 0) {
    return <NoPackages viewer={viewer} />;
  }

  const { pkg: pkgParam } = await searchParams;
  const cookieStore = await cookies();
  const active =
    resolveActivePackage(
      packages,
      typeof pkgParam === "string" ? pkgParam : null,
      cookieStore.get("fc_pkg")?.value ?? null,
    ) ?? packages[0];
  const others = packages.filter((candidate) => candidate.id !== active.id);

  // One fetch per package; a single failing package degrades to a note on its
  // group instead of taking the whole archive down.
  const settled = await Promise.allSettled([
    listSessions(active.id),
    ...others.map((candidate) => listSessions(candidate.id)),
  ]);
  const [activeResult, ...otherResults] = settled;
  const activeSessions =
    activeResult.status === "fulfilled" ? activeResult.value : null;
  const otherSessions = otherResults.map((result) =>
    result.status === "fulfilled" ? result.value : null,
  );

  const anyScoring = [activeSessions, ...otherSessions].some(
    (sessions) =>
      sessions?.some((session) => session.status === "scoring") ?? false,
  );
  const anyFailedFetch =
    activeSessions === null || otherSessions.some((sessions) => sessions === null);

  return (
    <Shell viewer={viewer} width="wide">
      {/* Scoring rows flip on their own; a failed fetch gets retried the same
          way. Mounted once for the whole page. */}
      {anyScoring || anyFailedFetch ? <PollRefresh intervalMs={5000} /> : null}

      <h1 className="text-2xl font-bold tracking-tight">Sessions</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {active.role_title ?? "Your interview package"} · {active.sessions_used} of{" "}
        {active.total_sessions} sessions used
      </p>

      <div className="mt-6">
        {activeSessions === null ? (
          <p className="text-sm text-ink-muted">
            Couldn&apos;t load this package&apos;s sessions right now — this page
            retries by itself.
          </p>
        ) : activeSessions.length === 0 ? (
          <div className="flex flex-col items-start gap-4 py-6">
            <p className="text-sm text-ink-muted">
              Nothing here yet — your first session appears the moment you finish
              it.
            </p>
            <Link href="/home" className={PRIMARY_BUTTON}>
              Start your first session
            </Link>
          </div>
        ) : (
          <ArchiveTable sessions={activeSessions} />
        )}
      </div>

      {others.length > 0 ? (
        <section className="mt-10 flex flex-col gap-6">
          <h2 className="text-xs font-semibold tracking-wide text-ink-faint uppercase">
            Other packages
          </h2>
          {others.map((candidate, i) => (
            <PackageGroup
              key={candidate.id}
              pkg={candidate}
              sessions={otherSessions[i]}
            />
          ))}
        </section>
      ) : null}
    </Shell>
  );
}
