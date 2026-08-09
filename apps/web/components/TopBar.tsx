import { cookies } from "next/headers";
import Link from "next/link";

import LightDismiss from "@/components/LightDismiss";
import PackageIdentity from "@/components/PackageIdentity";
import {
  ACTIVE_PACKAGE_COOKIE,
  NAV_TABS,
  activeNavTab,
  packageDisplayTitle,
  switchHref,
} from "@/lib/home";
import { resolveActivePackage, standardPackages } from "@/lib/active-package";
import type { Viewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";
import { listPackagesForUser } from "@/lib/worker";
import {
  DIVIDER,
  MENU_PANEL,
  MENU_ROW,
  SECONDARY_BUTTON,
  SECTION_HEADING,
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
//
// Both menus disclose through LightDismiss (F-57), the one client boundary
// here; everything that crosses it is rendered ReactNode and class strings.
// Two menus need no coordination: opening one starts with a pointerdown
// outside the other, which closes it before the click lands (the primitive's
// header records the keyboard-only caveat).

const SUMMARY =
  "flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden";

function Chevron() {
  return (
    <span aria-hidden="true" className="text-label text-ink-faint">
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
    <LightDismiss
      className="relative order-2"
      summaryClassName={`${SUMMARY} rounded-control px-2 py-1 text-fine text-ink-muted hover:bg-paper-sunk`}
      panelClassName={`${MENU_PANEL} left-0`}
      summary={
        <>
          {/* The identity stays outside the title's truncating span with a
              cap of its own, so the mark is never what truncates; the seat
              collapses (empty:hidden) when PackageIdentity renders null, so
              a package with no company shows exactly today's trigger with no
              phantom gap. */}
          <span className="flex min-w-0 max-w-28 empty:hidden sm:max-w-36">
            <PackageIdentity
              packageId={active.id}
              company={active.company}
              jdUrl={active.jd_url}
              variant="row"
            />
          </span>
          <span className="max-w-36 truncate sm:max-w-48">
            {packageDisplayTitle(active.role_title)}
          </span>
          <Chevron />
        </>
      }
    >
      <ul>
        {packages.map((pkg) => (
          <li key={pkg.id}>
            {/* Centered, not baseline-aligned: the left group is a flex
                container, and a flex container hands its first item's
                baseline up. With a favicon mark first that is the image's
                bottom edge, which dropped the count 3.9px below the title on
                exactly the rows that carry a mark (headless Chrome
                measurement). Centering is exact for the two texts because
                both are text-fine. */}
            <Link
              href={switchHref(pkg.id, path)}
              aria-current={pkg.id === active.id ? "true" : undefined}
              className={`${MENU_ROW} flex items-center justify-between gap-3 ${
                pkg.id === active.id ? "font-medium" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <PackageIdentity
                  packageId={pkg.id}
                  company={pkg.company}
                  jdUrl={pkg.jd_url}
                  variant="row"
                />
                <span className="truncate">
                  {packageDisplayTitle(pkg.role_title)}
                </span>
              </span>
              <span className="shrink-0 text-fine text-ink-faint tabular-nums">
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
    </LightDismiss>
  );
}

function AccountMenu({ viewer }: { viewer: Viewer }) {
  const initial = viewer.email?.trim()?.[0]?.toUpperCase() ?? "•";
  return (
    <LightDismiss
      className="relative order-3 ml-auto sm:order-4"
      summaryClassName={SUMMARY}
      summaryLabel="Account menu"
      panelClassName={`${MENU_PANEL} right-0`}
      summary={
        <>
          <span className="flex size-7 items-center justify-center rounded-full bg-ink text-fine text-paper">
            {initial}
          </span>
          <Chevron />
        </>
      }
    >
      <p className="truncate px-3 py-2 text-fine text-ink-faint">
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
    </LightDismiss>
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
            data-tour={tab.tour}
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
      owned = standardPackages(packages);
    } else {
      try {
        owned = standardPackages(await listPackagesForUser(viewer.id));
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
        {/* The wordmark is the way back OUT of the product, signed in or
            not (user direction 2026-08-05); the HOME tab beside it is the
            way back in. */}
        <Link href="/" className={`order-1 py-4 ${SECTION_HEADING}`}>
          flightcheck
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
          <nav className="order-2 ml-auto flex items-center gap-5 py-3 text-fine">
            <Link href="/quick" className="underline underline-offset-4">
              Quick interview
            </Link>
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
