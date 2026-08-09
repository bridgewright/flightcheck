// Which package a cross-package screen (home, sessions, progress, rubric)
// is currently "about". Quick packages are funnel artifacts and are filtered
// out here, so home, sessions, progress, rubric, package overview, and the
// switch menu never surface them. Pure resolution over standard packages —
// the caller supplies the ?pkg= query value and the fc_pkg cookie value;
// the /switch route owns writing that cookie.
import type { PackageSummary } from "@/lib/worker";

/**
 * The viewer's real packages: one job description each, a compiled rubric,
 * sessions worth listing.
 *
 * A quick package holds a company name, a role title, and one unscored
 * five-minute conversation that was never even processed. It exists so the
 * funnel has something to hang a session on, and it belongs on exactly one
 * screen: the pitch page that quick interview ends at.
 *
 * Shared rather than repeated, because it was repeated: /packages listed the
 * raw worker response, so the overview showed quick packages as cards with a
 * blank role, "0 of 1 sessions used", an Open button onto a screen that
 * resolves a different package, and a Delete button. The switcher and the
 * active-package resolution each filtered separately and the third caller was
 * simply forgotten.
 */
export function standardPackages(packages: PackageSummary[]): PackageSummary[] {
  return packages.filter((pkg) => pkg.kind !== "quick");
}

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
  const standard = standardPackages(packages);
  for (const hint of [pkgQueryParam, cookieValue]) {
    if (typeof hint === "string" && hint !== "") {
      const match = standard.find((pkg) => pkg.id === hint);
      if (match !== undefined) {
        return match;
      }
    }
  }
  return standard[0] ?? null;
}
