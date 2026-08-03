import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import PollRefresh from "@/components/PollRefresh";
import RubricView from "@/components/RubricView";
import Shell from "@/components/Shell";
import StartSessionButton from "@/components/StartSessionButton";
import { resolveActivePackage } from "@/lib/active-package";
import {
  checkoutHref,
  effectiveTotalSessions,
  isUnpaid,
  nextSessionNumber,
  unlockCtaLabel,
} from "@/lib/home";
import { PRIMARY_BUTTON, QUIET_LINK } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import type { SessionSummary } from "@/lib/worker";
import {
  getPackageByToken,
  listPackagesForUser,
  listSessions,
  packageTotalSessions,
} from "@/lib/worker";

export const dynamic = "force-dynamic";

// S5 — the bar made visible. The full rubric the sessions are scored
// against: dimensions with weights, channels, signals, and BARS anchors.
// With ?reveal=1 (the redirect target right after a package compiles) it
// opens with the one-time framing; without it, it is the plain reference
// screen behind the "Role & Rubric" tab.
//
// rubric.question_bank never renders here or anywhere: rehearsed answers
// score as prepared delivery, and the verdict stops meaning "would you
// pass". The dimensions are the bar; the questions are the probe.
export default async function RubricPage({
  searchParams,
}: {
  searchParams: Promise<{ pkg?: string; reveal?: string }>;
}) {
  const { pkg: pkgParam, reveal } = await searchParams;
  // The proxy already bounces signed-out visitors; this is the in-page
  // guarantee so the route stays safe even if the matcher drifts.
  const viewer = await getViewer();
  if (!viewer) {
    redirect("/login?next=/rubric");
  }

  let packages;
  try {
    packages = await listPackagesForUser(viewer.id);
  } catch {
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col gap-3 py-16">
          <h1 className="text-2xl font-bold tracking-tight">
            Your rubric is unavailable right now
          </h1>
          <p className="text-ink-muted">
            The scoring service could not be reached. Nothing is lost. Reload
            in a moment.
          </p>
        </div>
      </Shell>
    );
  }

  const cookieStore = await cookies();
  const active = resolveActivePackage(
    packages,
    pkgParam ?? null,
    cookieStore.get("fc_pkg")?.value ?? null,
  );

  if (!active) {
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col items-start gap-4 py-16">
          <h1 className="text-2xl font-bold tracking-tight">No rubric yet</h1>
          <p className="text-ink-muted">
            Paste the JD you are applying to and we compile the rubric your
            sessions are scored against.
          </p>
          <Link href="/new" className={PRIMARY_BUTTON}>
            Set up your interview package
          </Link>
        </div>
      </Shell>
    );
  }

  if (active.status === "compiling") {
    return (
      <Shell viewer={viewer}>
        <PollRefresh intervalMs={3000} />
        <div className="flex flex-col gap-3 py-16">
          <h1 className="text-2xl font-bold tracking-tight">
            Compiling your rubric&hellip;
          </h1>
          <p className="text-ink-muted">
            We are reading the JD, researching how this role actually
            interviews, and compiling your rubric. This page refreshes itself
            — usually 1&ndash;2 minutes.
          </p>
        </div>
      </Shell>
    );
  }

  // "failed" is honest and terminal; a "ready" package without a rubric (or
  // one the worker cannot serve right now) gets the same exit: try again
  // from a fresh JD rather than pretending a bar exists.
  const pkg =
    active.status === "failed"
      ? null
      : await getPackageByToken(active.access_token).catch(() => null);
  if (!pkg || !pkg.rubric) {
    return (
      <Shell viewer={viewer}>
        <div className="flex flex-col gap-3 py-16">
          <h1 className="text-2xl font-bold tracking-tight">
            We could not compile this package
          </h1>
          <p className="text-ink-muted">
            Rubric compilation failed — most often because the JD page could
            not be read. No charge, nothing saved.{" "}
            <Link href="/new" className={QUIET_LINK}>
              Try again
            </Link>{" "}
            with the JD pasted as text instead of a URL.
          </p>
        </div>
      </Shell>
    );
  }

  const rubric = pkg.rubric;
  // Effective quota (lib/home): an unpaid package owes 1 session here too.
  const total = effectiveTotalSessions({
    is_trial: pkg.is_trial,
    paid_at: pkg.paid_at,
    total_sessions: packageTotalSessions(pkg),
  });
  const sessions = await listSessions(pkg.id).catch(() => [] as SessionSummary[]);
  const next = nextSessionNumber(sessions, total);
  const trial = isUnpaid(pkg);

  return (
    <Shell viewer={viewer}>
      {reveal === "1" ? (
        <div className="mb-8 border-b border-hairline pb-8">
          <p className="text-2xl font-bold tracking-tight">This is the bar.</p>
          <p className="mt-2 text-ink-muted">
            Every session is scored against these dimensions — nothing else.
          </p>
        </div>
      ) : null}

      <h1 className="text-2xl font-bold tracking-tight text-balance">
        {rubric.role_title}
      </h1>
      <p className="mt-1 mb-8 text-sm text-ink-muted">
        {rubric.company ? `${rubric.company} · ` : ""}compiled from your JD
      </p>

      <RubricView rubric={rubric} />

      <div className="mt-10 flex flex-col gap-2 border-t border-hairline pt-8">
        {next === null ? (
          trial ? (
            <>
              <p className="text-sm text-ink-muted">
                Your trial session is used. The rest of this package scores
                against this same rubric.
              </p>
              <Link
                href={checkoutHref(pkg.id)}
                className={`${PRIMARY_BUTTON} self-start`}
              >
                {unlockCtaLabel()}
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                All {total} sessions of this package are used.
              </p>
              <Link href="/pricing" className={`${PRIMARY_BUTTON} self-start`}>
                See pricing
              </Link>
            </>
          )
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Session {next} of {total} is next.
            </p>
            <StartSessionButton packageId={pkg.id} />
          </>
        )}
      </div>
    </Shell>
  );
}
