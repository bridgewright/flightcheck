import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import RetryCompileButton from "@/components/RetryCompileButton";
import Shell from "@/components/Shell";
import { retryCompileAction } from "@/app/packages/actions";
import type { PillTone } from "@/lib/home";
import {
  effectiveTotalSessions,
  expiryLine,
  latestVerdict,
  packageDisplayTitle,
  packagePill,
  switchHref,
  verdictPhrase,
} from "@/lib/home";
import type { Verdict } from "@/lib/types";
import { PRIMARY_BUTTON } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser, listSessions } from "@/lib/worker";

export const dynamic = "force-dynamic";

// One package = one JD = one bar. This screen is the overview; everything a
// package contains lives on /home once it is the active one, so a card says
// only what distinguishes packages from each other and hands over to /switch.

const PILL_CLASSES: Record<PillTone, string> = {
  neutral:
    "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  wait: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  done: "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900",
};

function SignedOut() {
  return (
    <Shell viewer={null} path="/packages">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          You need to sign in to see your packages.
        </h1>
        <Link href="/login?next=/packages" className={PRIMARY_BUTTON}>
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
    <Shell viewer={viewer} path="/packages" packages={[]}>
      <PollRefresh intervalMs={5000} />
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Can&apos;t reach your packages right now.
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

function Empty({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer} path="/packages" packages={[]}>
      <div className="flex flex-col items-center gap-5 py-14 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          No packages yet.
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

function PackageCard({
  pkg,
  verdict,
}: {
  pkg: PackageSummary;
  verdict: Verdict | null;
}) {
  // Effective quota (lib/home): an unpaid trial reads "of 1", never "of 6".
  const total = effectiveTotalSessions(pkg);
  const pill = packagePill(pkg.status, pkg.sessions_used, total);
  const expiry = expiryLine(pkg, new Date());
  return (
    <li className="flex flex-col gap-3 rounded-md border border-neutral-300 p-5 dark:border-neutral-700">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-balance">
          {packageDisplayTitle(pkg.role_title)}
        </h2>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${PILL_CLASSES[pill.tone]}`}
        >
          {pill.label}
        </span>
      </div>
      <p className="text-sm text-neutral-600 tabular-nums dark:text-neutral-400">
        {pkg.sessions_used} of {total} sessions used
        {verdict !== null ? ` · Last verdict: ${verdictPhrase(verdict)}` : ""}
      </p>
      {expiry !== null ? (
        <p className="text-xs text-neutral-500">{expiry}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={switchHref(pkg.id, "/home")}
          className="self-start rounded-md border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700"
        >
          Open
        </Link>
        {/* A failed compile is retryable (the worker re-queues the same JD);
            the pill lives right where the red status is read. */}
        {pkg.status === "failed" ? (
          <RetryCompileButton packageId={pkg.id} action={retryCompileAction} />
        ) : null}
      </div>
    </li>
  );
}

export default async function PackagesPage() {
  const viewer = await getViewer();
  if (!viewer) {
    return <SignedOut />;
  }

  let packages: PackageSummary[];
  let verdicts: (Verdict | null)[];
  try {
    packages = await listPackagesForUser(viewer.id);
    // The card's verdict word comes from the same session summaries /home
    // reads. A package whose sessions cannot be listed shows no verdict
    // rather than sinking the whole overview.
    verdicts = await Promise.all(
      packages.map((pkg) =>
        listSessions(pkg.id)
          .then((sessions) => latestVerdict(sessions))
          .catch(() => null),
      ),
    );
  } catch {
    return <Unreachable viewer={viewer} />;
  }
  if (packages.length === 0) {
    return <Empty viewer={viewer} />;
  }

  return (
    <Shell viewer={viewer} path="/packages" packages={packages}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Your packages</h1>
        <Link href="/new" className={PRIMARY_BUTTON}>
          New package
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {packages.map((pkg, i) => (
          <PackageCard key={pkg.id} pkg={pkg} verdict={verdicts[i]} />
        ))}
      </ul>
    </Shell>
  );
}
