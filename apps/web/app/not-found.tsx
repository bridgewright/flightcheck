import Link from "next/link";

import { MAIN_READING, PAGE_HEADING, PRIMARY_BUTTON, SUBTLE } from "@/lib/ui";

export default function NotFound() {
  return (
    <main className={`${MAIN_READING} flex min-h-dvh flex-col items-center justify-center gap-4 text-center`}>
      <div className="text-section">
        <span>flight</span>check
      </div>
      <h1 className={`${PAGE_HEADING} text-balance`}>
        There is no page at this address.
      </h1>
      <p className={`${SUBTLE} max-w-md`}>
        The link may be wrong or the page may have moved. Your sessions and
        reports are unaffected.
      </p>
      <Link href="/home" className={PRIMARY_BUTTON}>
        Go to your home
      </Link>
    </main>
  );
}
