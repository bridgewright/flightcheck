// Which company a package is for, decided once for every surface (F-56).
//
// Composition only: the trim/null rule is lib/home's packageCompanyLine and
// the which-domain-may-stand-for-the-employer rule is lib/company-mark's
// companyMarkHost. This module exists so the /packages card, the top-bar
// switcher, and every page subtitle answer the question identically instead
// of each re-deriving half of it.

import { companyMarkHost } from "@/lib/company-mark";
import { packageCompanyLine } from "@/lib/home";

export interface PackageIdentityDecision {
  /** The trimmed company name a surface may print. */
  company: string;
  /** Whether the favicon mark rides along: only when the pasted JD URL names
   * a domain the proxy would actually fetch. */
  showMark: boolean;
}

/**
 * The identity a surface may render, or null for nothing at all.
 *
 * Null means the surface renders exactly as it would without this feature:
 * no placeholder, no empty chip. The JD never named a company, or the
 * compiler has not run yet, and the two are indistinguishable on purpose.
 */
export function packageIdentityDecision(
  company: string | null | undefined,
  jdUrl: string | null | undefined,
): PackageIdentityDecision | null {
  const name = packageCompanyLine(company);
  if (name === null) return null;
  return { company: name, showMark: companyMarkHost(jdUrl) !== null };
}
