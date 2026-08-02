import TopBar from "@/components/TopBar";
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
  "2xl": "max-w-2xl",
  // Matches the TopBar's own inner width, for screens with side-by-side or
  // full-bleed content (landing, tables).
  wide: "max-w-5xl",
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
      <main className={`mx-auto w-full ${WIDTHS[width]} px-6 pt-10 pb-12`}>
        {children}
      </main>
    </>
  );
}
