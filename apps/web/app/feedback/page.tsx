import { cookies } from "next/headers";
import Link from "next/link";

import FeedbackForm from "@/components/FeedbackForm";
import Shell from "@/components/Shell";
import { resolveActivePackage } from "@/lib/active-package";
import { ACTIVE_PACKAGE_COOKIE } from "@/lib/home";
import { MUTED, PAGE_HEADING, PRIMARY_BUTTON } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser } from "@/lib/worker";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const viewer = await getViewer();
  if (!viewer) return <Shell viewer={null}><div className="flex flex-col items-center gap-4 py-16 text-center"><h1 className={PAGE_HEADING}>Sign in to send feedback.</h1><Link className={PRIMARY_BUTTON} href="/login?next=/feedback">Sign in</Link></div></Shell>;
  // Hand the packages we already fetched to the Shell: undefined on failure,
  // so the bar keeps its own fallback fetch rather than inheriting our miss.
  let packages: PackageSummary[] | undefined;
  let packageId: string | undefined;
  try {
    packages = await listPackagesForUser(viewer.id);
    const store = await cookies();
    packageId = resolveActivePackage(packages, null, store.get(ACTIVE_PACKAGE_COOKIE)?.value)?.id;
  } catch { /* Feedback still works without package context. */ }
  return <Shell viewer={viewer} path="/feedback" packages={packages} activePackageId={packageId}><h1 className={PAGE_HEADING}>Feedback</h1><p className={`${MUTED} mt-3`}>Tell us what worked and what could be better.</p><FeedbackForm packageId={packageId} /></Shell>;
}
