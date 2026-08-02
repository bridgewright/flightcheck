// Which package a cross-package screen (home, sessions, progress, rubric)
// is currently "about". Pure resolution over the viewer's own packages —
// the caller supplies the ?pkg= query value and the fc_pkg cookie value;
// the /switch route owns writing that cookie.
import type { PackageSummary } from "@/lib/worker";

/**
 * Precedence: ?pkg= query > fc_pkg cookie > newest owned package.
 *
 * Ids that do not appear in the viewer's own list are ignored (a stale
 * cookie or a pasted foreign id silently falls through to the next rule —
 * these are hints, not capabilities; real authorization happens elsewhere).
 * The worker lists packages newest-first (created_at desc), so "newest" is
 * the head of the list. Null only when the viewer owns no packages.
 */
export function resolveActivePackage(
  packages: PackageSummary[],
  pkgQueryParam: string | null | undefined,
  cookieValue: string | null | undefined,
): PackageSummary | null {
  for (const hint of [pkgQueryParam, cookieValue]) {
    if (typeof hint === "string" && hint !== "") {
      const match = packages.find((pkg) => pkg.id === hint);
      if (match !== undefined) {
        return match;
      }
    }
  }
  return packages[0] ?? null;
}
