import Link from "next/link";

import type { Viewer } from "@/lib/viewer";

// The app chrome. `viewer` is the ONLY identity input: pages resolve it through
// lib/viewer.getViewer() and pass it down, so this component never reaches for
// a session itself. The auth track replaces the avatar with the real
// account/sign-out control — that swap is confined to the branch below.
export default function TopBar({ viewer = null }: { viewer?: Viewer | null }) {
  const initial = viewer?.email?.trim()?.[0]?.toUpperCase() ?? "•";
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-6 py-4">
        <Link href={viewer ? "/home" : "/"} className="text-lg">
          <span className="font-bold">flight</span>check
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <Link href="/pricing" className="underline underline-offset-4">
            Pricing
          </Link>
          {viewer ? (
            <span
              className="flex size-7 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white dark:bg-white dark:text-neutral-900"
              title={viewer.email ?? "Signed in"}
            >
              {initial}
              <span className="sr-only">Signed in as {viewer.email ?? "your account"}</span>
            </span>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-neutral-300 px-4 py-1.5 dark:border-neutral-700"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
