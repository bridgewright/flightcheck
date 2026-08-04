import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import DeletePackageButton from "@/components/DeletePackageButton";
import RetryCompileButton from "@/components/RetryCompileButton";
import Shell from "@/components/Shell";
import { deletePackageAction, retryCompileAction } from "@/app/packages/actions";
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
import { CARD, CHIP, CHIP_ALARM, CHIP_BLUSH, CHIP_SHELL, FINE_PRINT, PAGE_HEADING, PRIMARY_BUTTON, SECONDARY_BUTTON, SUBTLE, SUB_HEADING } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser, listSessions } from "@/lib/worker";

export const dynamic = "force-dynamic";

// One package = one JD = one bar. This screen is the overview; everything a
// package contains lives on /home once it is the active one, so a card says
// only what distinguishes packages from each other and hands over to /switch.

const PILL_CLASSES: Record<PillTone, string> = {
  neutral: CHIP,
  wait: CHIP_BLUSH,
  bad: CHIP_ALARM,
  done: `${CHIP_SHELL} bg-ink text-paper`,
};

function SignedOut() {
  return (
    <Shell viewer={null} path="/packages">
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
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
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Can&apos;t reach your packages right now.
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

function Empty({ viewer }: { viewer: Viewer }) {
  return (
    <Shell viewer={viewer} path="/packages" packages={[]}>
      <div className="flex flex-col items-center gap-5 py-14 text-center">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          No packages yet.
        </h1>
        <p className="max-w-md text-ink-muted">
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
    <li className={`${CARD} flex flex-col gap-3 p-5`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className={`${SUB_HEADING} text-balance`}>
          {packageDisplayTitle(pkg.role_title)}
        </h2>
        <span
          className={`${PILL_CLASSES[pill.tone]} shrink-0`}
        >
          {pill.label}
        </span>
      </div>
      <p className={`${SUBTLE} tabular-nums`}>
        {pkg.sessions_used} of {total} sessions used
        {verdict !== null ? ` · Last verdict: ${verdictPhrase(verdict)}` : ""}
      </p>
      {expiry !== null ? (
        <p className={FINE_PRINT}>{expiry}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={switchHref(pkg.id, "/home")}
          className={`${SECONDARY_BUTTON} self-start`}
        >
          Open
        </Link>
        {/* A failed compile is retryable (the worker re-queues the same JD);
            the pill lives right where the alarm status is read. */}
        {pkg.status === "failed" ? (
          <RetryCompileButton packageId={pkg.id} action={retryCompileAction} />
        ) : null}
        <DeletePackageButton
          packageId={pkg.id}
          title={packageDisplayTitle(pkg.role_title)}
          sessionsUsed={pkg.sessions_used}
          action={deletePackageAction}
        />
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
        <h1 className={PAGE_HEADING}>Your packages</h1>
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
