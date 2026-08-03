"use server";

import { getViewer } from "@/lib/viewer";
import { WorkerError, listPackagesForUser, retryCompile } from "@/lib/worker";

// Server action behind the "Retry compile" pill on the home and packages
// screens. A server action is a public endpoint in disguise, so it carries
// the same discipline as the API routes: anonymous callers are refused
// before the worker hears anything, and ownership is checked against the
// caller's own package list — an unknown id and a foreign id get the same
// answer, so ownership is not probeable. Failures come back as calm result
// objects, never as thrown errors that would take down the page.

export interface RetryCompileResult {
  ok: boolean;
  error?: string;
}

const NOT_RETRIABLE = "That package can't be retried.";
const TRY_AGAIN = "The retry didn't start. Try again in a moment.";

export async function retryCompileAction(packageId: string): Promise<RetryCompileResult> {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false, error: "You are signed out. Sign in, then retry." };
  }
  if (typeof packageId !== "string" || packageId === "") {
    return { ok: false, error: NOT_RETRIABLE };
  }
  let owned: boolean;
  try {
    const packages = await listPackagesForUser(viewer.id);
    owned = packages.some((pkg) => pkg.id === packageId);
  } catch {
    return {
      ok: false,
      error: "The scoring service is briefly unreachable. Try again in a moment.",
    };
  }
  if (!owned) {
    return { ok: false, error: NOT_RETRIABLE };
  }
  try {
    await retryCompile(packageId);
    return { ok: true };
  } catch (err) {
    // A 4xx with a detail is the worker refusing this specific retry (e.g.
    // the package is not in a failed state) — the user can act on that. A
    // 5xx or opaque failure gets the generic line; status codes are logs,
    // not UI copy.
    if (err instanceof WorkerError && err.status < 500 && err.detail) {
      return { ok: false, error: err.detail };
    }
    console.error("compile retry failed", err);
    return { ok: false, error: TRY_AGAIN };
  }
}
