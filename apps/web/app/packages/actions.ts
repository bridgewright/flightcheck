"use server";

import { getViewer } from "@/lib/viewer";
import { WorkerError, deletePackage, listPackagesForUser, retryCompile } from "@/lib/worker";

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

export interface DeletePackageResult {
  ok: boolean;
  error?: string;
}

const NOT_DELETABLE = "That package can't be deleted.";

/**
 * Delete one package and everything under it (F-53).
 *
 * Same discipline as the retry above: signed out is refused here, ownership
 * is checked against the caller's own list, and an unknown id and a foreign
 * id get the same answer so ownership is not probeable. The worker checks
 * ownership again on its side; this check is the one that keeps a foreign id
 * from ever reaching it.
 *
 * The 503 case is the one that must not be softened. Recordings are deleted
 * before rows, so "we could not delete the recordings" means nothing at all
 * was removed and the package is intact. Telling the user it worked, or
 * retrying quietly, would leave them believing their audio is gone.
 */
export async function deletePackageAction(
  packageId: string,
): Promise<DeletePackageResult> {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false, error: "You are signed out. Sign in, then try again." };
  }
  if (typeof packageId !== "string" || packageId === "") {
    return { ok: false, error: NOT_DELETABLE };
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
    return { ok: false, error: NOT_DELETABLE };
  }
  try {
    await deletePackage(packageId, viewer.id);
    return { ok: true };
  } catch (err) {
    if (err instanceof WorkerError && err.status === 503) {
      return {
        ok: false,
        error: `We could not delete this package's recordings just now, so nothing was deleted. Try again in a few minutes.`,
      };
    }
    if (err instanceof WorkerError && err.status < 500 && err.detail) {
      return { ok: false, error: err.detail };
    }
    console.error("package deletion failed", err);
    return { ok: false, error: "The deletion didn't run. Try again in a moment." };
  }
}
