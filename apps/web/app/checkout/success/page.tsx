import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import PollRefresh from "@/components/PollRefresh";
import Shell from "@/components/Shell";
import { resolveActivePackage } from "@/lib/active-package";
import { ACTIVE_PACKAGE_COOKIE } from "@/lib/home";
import { EXPIRY_DAYS, PACKAGE_SESSIONS } from "@/lib/pricing";
import { PAGE_HEADING, PRIMARY_BUTTON, LINK, SUBTLE } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import { getViewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser } from "@/lib/worker";

// Landing after Polar's hosted checkout. Payment truth arrives over the
// order.paid webhook, not with the browser — so this page POLLS the package's
// paid state and only claims confirmation once paid_at is real. Until then it
// says "confirming", which is exactly what is happening.

export const dynamic = "force-dynamic";

// Transactional page tied to an account — noindex.
export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false, follow: false },
};

function Confirming({ viewer }: { viewer: Viewer | null }) {
  return (
    <Shell viewer={viewer}>
      <PollRefresh intervalMs={3000} />
      <div className="mx-auto flex w-full max-w-md flex-col pt-4">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Confirming your payment&hellip;
        </h1>
        <p className="mt-3 text-ink-muted">
          Polar is telling us about your payment now. That usually takes a few
          seconds. This page updates by itself; there is nothing else to do.
        </p>
        <p className={`${SUBTLE} mt-2`}>
          Taking longer than a minute? The confirmation sometimes lags the
          charge. Your payment is safe either way. Leave this page open or
          come back later.
        </p>
      </div>
    </Shell>
  );
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ pkg?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) {
    return (
      <Shell viewer={null}>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <h1 className={`${PAGE_HEADING} text-balance`}>
            Sign in to see your unlocked package.
          </h1>
          <Link href="/login?next=/checkout/success" className={PRIMARY_BUTTON}>
            Sign in
          </Link>
        </div>
      </Shell>
    );
  }

  const { pkg: pkgParam } = await searchParams;
  const cookieStore = await cookies();
  let active: PackageSummary | null;
  try {
    const packages = await listPackagesForUser(viewer.id);
    active = resolveActivePackage(
      packages,
      typeof pkgParam === "string" ? pkgParam : null,
      cookieStore.get(ACTIVE_PACKAGE_COOKIE)?.value ?? null,
    );
  } catch {
    // Worker briefly unreachable — keep polling rather than alarm someone
    // who just paid; the state on Polar's side is settled either way.
    return <Confirming viewer={viewer} />;
  }

  if (!active || !active.paid_at) {
    return <Confirming viewer={viewer} />;
  }

  return (
    <Shell viewer={viewer}>
      <div className="mx-auto flex w-full max-w-md flex-col pt-4">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Payment confirmed.
        </h1>
        <p className="mt-3 text-ink-muted">
          All {PACKAGE_SESSIONS} sessions of this package are unlocked: same job
          description, same rubric, fresh topics every session. They stay open
          for {EXPIRY_DAYS} days.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link href="/home" className={PRIMARY_BUTTON}>
            Start your next session
          </Link>
          <Link href="/settings" className={`${LINK} ${SUBTLE}`}>
            Receipts
          </Link>
        </div>
      </div>
    </Shell>
  );
}
