import Link from "next/link";

import type { Viewer } from "@/lib/viewer";

// The app chrome. `viewer` is the ONLY identity input: pages resolve it through
// lib/viewer.getViewer() and pass it down, so this component never reaches for
// a session itself. The auth track replaces the avatar with the real
// account/sign-out control — that swap is confined to the branch below.
export default function TopBar({ viewer = null }: { viewer?: Viewer | null }) {
  const initial = viewer?.email?.trim()?.[0]?.toUpperCase() ?? "•";
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-7 py-4">
        <Link href={viewer ? "/home" : "/"} className="font-display text-[17px] text-ink">
          <span className="font-semibold">flight</span>check
        </Link>
        <nav className="flex items-center gap-5 text-[13.5px] text-muted">
          <Link href="/pricing" className="transition-colors hover:text-ink">
            Pricing
          </Link>
          {viewer ? (
            <span
              className="flex size-7 items-center justify-center rounded-full bg-coral text-xs font-bold text-white"
              title={viewer.email ?? "Signed in"}
            >
              {initial}
              <span className="sr-only">Signed in as {viewer.email ?? "your account"}</span>
            </span>
          ) : (
            <Link
              href="/login"
              className="rounded-[9px] border border-line px-4 py-[7px] text-ink transition-colors hover:border-faint"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
