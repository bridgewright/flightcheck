"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { LINK, MAIN_READING, PAGE_HEADING, PRIMARY_BUTTON, SUBTLE } from "@/lib/ui";

// S15 — the package link belongs to someone else. Rendered with a real
// HTTP 403 by forbidden() from the /p/[token] claim page. Client component
// only because the switch-account form needs the current path (forbidden
// boundaries receive no params); everything else is static copy.
//
// The copy is fixed (F-07 spec §7): say whose the package is not, say what
// to do, and offer exactly one primary way out. "Switch account" is a plain
// form POST to the shared signout route; its `next` field brings the user
// back to this package link after they sign in as the right account.
export default function ForbiddenPackage() {
  const pathname = usePathname() ?? "/";
  return (
    <main className={`${MAIN_READING} flex min-h-dvh flex-col items-center justify-center gap-4 text-center`}>
      <div className="text-section">
        <span>flight</span>check
      </div>
      <h1 className={`${PAGE_HEADING} text-balance`}>
        This package belongs to a different account.
      </h1>
      <p className={`${SUBTLE} max-w-md`}>
        Sign in with the account that opened it.
      </p>
      <form method="post" action="/auth/signout">
        <input type="hidden" name="next" value={pathname} />
        <button type="submit" className={PRIMARY_BUTTON}>
          Switch account
        </button>
      </form>
      <Link href="/home" className={`${LINK} ${SUBTLE}`}>
        Go to your home
      </Link>
    </main>
  );
}
