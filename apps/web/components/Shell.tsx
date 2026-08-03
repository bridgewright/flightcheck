import Link from "next/link";

import { LEGAL_LINKS, SUPPORT_EMAIL, supportMailto } from "@/app/legal/policy";
import TopBar from "@/components/TopBar";
import { DIVIDER, QUIET_LINK } from "@/lib/ui";
import type { Viewer } from "@/lib/viewer";
import type { PackageSummary } from "@/lib/worker";

// The app chrome for every page that has chrome: TopBar plus a centered
// <main>. Deliberately NOT mounted in the root layout — the session room and
// login render chrome-less, so each page opts in with one wrapper instead of
// hand-rolling its own copy.
//
// path/packages/activePackageId pass straight through to the TopBar (see its
// prop docs): pages pass their own pathname for the active section tab, and
// whatever package context they already fetched so the bar does not fetch it
// again. All three are optional — a page that passes nothing gets a bar that
// resolves its own switcher state.
const WIDTHS = {
  // The reading column most screens use.
  "2xl": "max-w-reading",
  // Matches the TopBar's own inner width, for screens with side-by-side or
  // full-bleed content (landing, tables).
  wide: "max-w-shell",
} as const;

export default function Shell({
  viewer,
  width = "2xl",
  path,
  packages,
  activePackageId,
  children,
}: {
  viewer: Viewer | null;
  width?: keyof typeof WIDTHS;
  path?: string;
  packages?: PackageSummary[];
  activePackageId?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopBar
        viewer={viewer}
        path={path}
        packages={packages}
        activePackageId={activePackageId}
      />
      {/* flex-1 pushes the footer to the viewport bottom on short pages —
          the root layout's body is already min-h-full flex-col. */}
      <main className={`mx-auto w-full flex-1 ${WIDTHS[width]} px-6 pt-10 pb-12 sm:px-10 lg:px-16 xl:px-24`}>
        {children}
      </main>
      {/* Quiet trust footer on every Shell page: the legal pages and a real
          person to write to. Links come from app/legal/policy.ts so the
          footer can never point at pages that do not exist. */}
      <footer className={`border-t ${DIVIDER}`}>
        <div className="mx-auto flex w-full max-w-shell flex-wrap items-center gap-x-5 gap-y-1 px-6 py-5 text-fine text-ink-faint sm:px-10 lg:px-16 xl:px-24">
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={QUIET_LINK}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={supportMailto()}
            className={QUIET_LINK}
          >
            Support: {SUPPORT_EMAIL}
          </a>
        </div>
      </footer>
    </>
  );
}
