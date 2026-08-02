import Link from "next/link";

import { PRIMARY_BUTTON } from "@/lib/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
      <div className="text-lg">
        <span className="font-bold">flight</span>check
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-balance">
        There is no page at this address.
      </h1>
      <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-400">
        The link may be wrong or the page may have moved. Your sessions and
        reports are unaffected.
      </p>
      <Link href="/home" className={PRIMARY_BUTTON}>
        Go to your home
      </Link>
    </main>
  );
}
