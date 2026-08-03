"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PAGE_HEADING, PRIMARY_BUTTON, QUIET_LINK, SUBTLE } from "@/lib/ui";

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
    <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
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
      <Link href="/home" className={`${QUIET_LINK} ${SUBTLE}`}>
        Go to your home
      </Link>
    </main>
  );
}
