import { cookies } from "next/headers";
import Link from "next/link";

import {
  ACTIVE_PACKAGE_COOKIE,
  NAV_TABS,
  activeNavTab,
  packageDisplayTitle,
  switchHref,
} from "@/lib/home";
import { resolveActivePackage } from "@/lib/active-package";
import type { Viewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser } from "@/lib/worker";
import {
  DIVIDER,
  MENU_PANEL,
  MENU_ROW,
  SECONDARY_BUTTON,
  TAB,
  TAB_ACTIVE,
} from "@/lib/ui";

// The app chrome, and a server component on purpose: the switcher and the
// active tab are computed from the request (cookie + pathname prop), never
// from client JS. `viewer` is the ONLY identity input — pages resolve it via
// lib/viewer.getViewer() and pass it down; this component never reaches for a
// session itself.
//
// Pages that already fetched the viewer's packages pass them in (with the id
// they resolved as active) so the worker is asked once per render; pages that
// did not simply omit them and the bar fetches its own. A worker outage
// degrades to a bar without a switcher — the page body owns the real error
// surface.

const SUMMARY =
  "flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden";

function Chevron() {
  return (
    <span aria-hidden="true" className="text-[9px] text-ink-faint">
      ▼
    </span>
  );
}

function PackageSwitcher({
  packages,
  activeId,
  path,
}: {
  packages: PackageSummary[];
  activeId: string | null;
  path: string;
}) {
  const active = packages.find((pkg) => pkg.id === activeId) ?? packages[0];
  return (
    <details className="relative order-2">
      <summary className={`${SUMMARY} rounded-field px-2 py-1 text-sm text-ink-muted hover:bg-paper-sunk`}>
        <span className="max-w-36 truncate sm:max-w-48">
          {packageDisplayTitle(active.role_title)}
        </span>
        <Chevron />
      </summary>
      <div className={`${MENU_PANEL} left-0`}>
        <ul>
          {packages.map((pkg) => (
            <li key={pkg.id}>
              <Link
                href={switchHref(pkg.id, path)}
                aria-current={pkg.id === active.id ? "true" : undefined}
                className={`${MENU_ROW} flex items-baseline justify-between gap-3 ${
                  pkg.id === active.id ? "font-semibold" : ""
                }`}
              >
                <span className="truncate">
                  {packageDisplayTitle(pkg.role_title)}
                </span>
                <span className="shrink-0 text-xs text-ink-faint tabular-nums">
                  {pkg.sessions_used}/{pkg.total_sessions}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <div className={`mt-1 border-t pt-1 ${DIVIDER}`}>
          <Link href="/packages" className={MENU_ROW}>
            All packages
          </Link>
          <Link href="/new" className={MENU_ROW}>
            New package
          </Link>
        </div>
      </div>
    </details>
  );
}

function AccountMenu({ viewer }: { viewer: Viewer }) {
  const initial = viewer.email?.trim()?.[0]?.toUpperCase() ?? "•";
  return (
    <details className="relative order-3 ml-auto sm:order-4">
      <summary className={SUMMARY} aria-label="Account menu">
        <span className="flex size-7 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">
          {initial}
        </span>
        <Chevron />
      </summary>
      <div className={`${MENU_PANEL} right-0`}>
        <p className="truncate px-3 py-2 text-xs text-ink-faint">
          {viewer.email ?? "Signed in"}
        </p>
        <Link href="/settings" className={MENU_ROW}>
          Settings
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className={`${MENU_ROW} w-full cursor-pointer text-left`}>
            Sign out
          </button>
        </form>
        <div className={`mt-1 border-t pt-1 ${DIVIDER}`}>
          <Link href="/pricing" className={MENU_ROW}>
            Pricing
          </Link>
        </div>
      </div>
    </details>
  );
}

function SectionTabs({ path }: { path: string | undefined }) {
  const active = activeNavTab(path);
  return (
    // One row of its own on mobile (order-4 + w-full inside the wrapping
    // flex container), inline between the switcher and the avatar from sm up.
    // Scrolling is plain CSS overflow — no JS.
    <nav
      aria-label="Sections"
      className="order-4 -mb-px flex w-full gap-1 overflow-x-auto sm:order-3 sm:ml-1 sm:w-auto sm:self-stretch"
    >
      {NAV_TABS.map((tab) => {
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={current ? TAB_ACTIVE : TAB}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default async function TopBar({
  viewer = null,
  path,
  packages,
  activePackageId,
}: {
  viewer?: Viewer | null;
  /** The pathname of the page rendering this bar. Drives the active tab and
   * where /switch bounces back to; omitted → no underline, switch → /home. */
  path?: string;
  /** The viewer's packages when the page already fetched them; omit and the
   * bar fetches its own (signed-in only). */
  packages?: PackageSummary[];
  /** Which package the page resolved as active (it saw the ?pkg= query; this
   * bar only sees the cookie). */
  activePackageId?: string;
}) {
  let owned: PackageSummary[] = [];
  let activeId: string | null = activePackageId ?? null;
  if (viewer) {
    if (packages !== undefined) {
      owned = packages;
    } else {
      try {
        owned = await listPackagesForUser(viewer.id);
      } catch {
        owned = [];
      }
    }
    if (activeId === null && owned.length > 0) {
      const cookie = (await cookies()).get(ACTIVE_PACKAGE_COOKIE)?.value ?? null;
      activeId = resolveActivePackage(owned, null, cookie)?.id ?? null;
    }
  }

  return (
    <header className={`border-b ${DIVIDER}`}>
      <div className="mx-auto flex w-full max-w-shell flex-wrap items-center gap-x-4 px-6 sm:px-10 lg:px-16 xl:px-24">
        <Link href={viewer ? "/home" : "/"} className="order-1 py-4 text-lg">
          <span className="font-bold">flight</span>check
        </Link>
        {viewer ? (
          <>
            {owned.length >= 1 ? (
              <PackageSwitcher
                packages={owned}
                activeId={activeId}
                path={path ?? "/home"}
              />
            ) : null}
            <SectionTabs path={path} />
            <AccountMenu viewer={viewer} />
          </>
        ) : (
          <nav className="order-2 ml-auto flex items-center gap-5 py-3 text-sm">
            <Link href="/sample-report" className="underline underline-offset-4">
              Sample report
            </Link>
            <Link href="/pricing" className="underline underline-offset-4">
              Pricing
            </Link>
            <Link
              href="/login"
              className={SECONDARY_BUTTON}
            >
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
