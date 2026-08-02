import { headers } from "next/headers";
import Link from "next/link";
import { forbidden, redirect } from "next/navigation";

import Shell from "@/components/Shell";
import { claimAction } from "@/lib/package-claim";
import { getViewer } from "@/lib/viewer";
import { authorizePackage, packageOwnerId } from "@/lib/worker";

export const dynamic = "force-dynamic";

// S15 — /p/[token] is a claim/redirect address, not a screen. The id-routed,
// login-scoped pages (/home, /rubric, /sessions/…) are where the product
// lives; a token link only decides who gets in and hands the visitor over:
//
//   signed out            → login, then back here
//   signed in, unowned    → bind to this account, then /switch → /home
//   signed in, owner      → /switch → /home
//   signed in, foreign    → forbidden() (HTTP 403, forbidden.tsx)
//   unknown token         → not-found copy
//   worker unreachable    → honest outage copy (never misread as a denial)
//
// The token stays out of every URL the user lands on afterwards — that is
// the point of the migration: browser history and referrers stop carrying a
// capability that unlocks voice recordings.

/**
 * Claims the package for the signed-in viewer through the existing bind
 * route, which re-reads identity from the forwarded cookie and only ever
 * binds a package whose user_id is null. Awaited: on a serverless runtime a
 * dangling promise can be cut off when the response finishes, and the whole
 * point is that the package appears on /home afterwards.
 *
 * Returns whether this call did the binding. False covers both "someone beat
 * us to it" and "bind route unreachable"; the caller re-checks ownership
 * rather than guessing which.
 */
async function bindToViewer(token: string): Promise<boolean> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host) {
    return false;
  }
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  try {
    const res = await fetch(`${proto}://${host}/api/packages/bind`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: requestHeaders.get("cookie") ?? "",
      },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { bound?: unknown };
    return body.bound === true;
  } catch {
    return false;
  }
}

export default async function PackageClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const viewer = await getViewer();
  const access = await authorizePackage(token);

  if (!access.ok) {
    if (access.status === 502) {
      return (
        <Shell viewer={viewer}>
          <div className="flex flex-col gap-3 py-16">
            <h1 className="text-2xl font-bold tracking-tight">
              This package is unavailable right now
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              The scoring service could not be reached. Nothing is lost —
              reload in a moment.
            </p>
          </div>
        </Shell>
      );
    }
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

  const pkg = access.value;
  const action = claimAction(viewer?.id ?? null, packageOwnerId(pkg));

  if (action === "login") {
    redirect(`/login?next=${encodeURIComponent(`/p/${token}`)}`);
  }
  if (action === "forbidden") {
    forbidden();
  }
  if (action === "claim") {
    const bound = await bindToViewer(token);
    if (!bound) {
      // Either a concurrent visitor claimed it first or the bind route was
      // unreachable. Re-read the truth instead of guessing: an owner match
      // falls through to /switch, a foreign owner is a 403, and an
      // still-unowned package (bind outage) gets the honest outage copy.
      const recheck = await authorizePackage(token);
      const owner = recheck.ok ? packageOwnerId(recheck.value) : null;
      if (owner !== null && owner !== viewer?.id) {
        forbidden();
      }
      if (owner === null) {
        return (
          <Shell viewer={viewer}>
            <div className="flex flex-col gap-3 py-16">
              <h1 className="text-2xl font-bold tracking-tight">
                This package is unavailable right now
              </h1>
              <p className="text-neutral-600 dark:text-neutral-400">
                The package could not be added to your account. Nothing is
                lost — reload in a moment.
              </p>
            </div>
          </Shell>
        );
      }
    }
  }

  // Owner (or fresh claimant): make it the active package and land home.
  redirect(`/switch?pkg=${encodeURIComponent(pkg.id)}&next=${encodeURIComponent("/home")}`);
}
