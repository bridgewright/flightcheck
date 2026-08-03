import type { Metadata } from "next";
import Link from "next/link";

import Shell from "@/components/Shell";
import { PAGE_HEADING, PRIMARY_BUTTON, QUIET_LINK, SUBTLE } from "@/lib/ui";
import { getViewer } from "@/lib/viewer";

// Landing for a checkout the user backed out of. Two honest facts, no
// pressure: nothing was charged, nothing was lost.

// Transactional page tied to an account — noindex.
export const metadata: Metadata = {
  title: "Checkout canceled",
  robots: { index: false, follow: false },
};

export default async function CheckoutCancelPage() {
  const viewer = await getViewer();
  return (
    <Shell viewer={viewer}>
      <div className="mx-auto flex w-full max-w-md flex-col pt-4">
        <h1 className={`${PAGE_HEADING} text-balance`}>
          Checkout canceled.
        </h1>
        <p className="mt-3 text-ink-muted">
          Nothing was charged. Your package is exactly as you left it: the
          trial session and every report stay available, and you can unlock
          the full package whenever it suits you.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <Link href="/pricing" className={PRIMARY_BUTTON}>
            Back to pricing
          </Link>
          <Link href="/home" className={`${QUIET_LINK} ${SUBTLE}`}>
            Your sessions
          </Link>
        </div>
      </div>
    </Shell>
  );
}
