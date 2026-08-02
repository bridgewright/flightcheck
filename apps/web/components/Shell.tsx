import TopBar from "@/components/TopBar";
import type { Viewer } from "@/lib/viewer";

// The app chrome for every page that has chrome: TopBar plus a centered
// <main>. Deliberately NOT mounted in the root layout — the session room and
// login render chrome-less, so each page opts in with one wrapper instead of
// hand-rolling its own copy.
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
  children,
}: {
  viewer: Viewer | null;
  width?: keyof typeof WIDTHS;
  children: React.ReactNode;
}) {
  return (
    <>
      <TopBar viewer={viewer} />
      <main className={`mx-auto w-full ${WIDTHS[width]} px-6 pt-10 pb-12`}>
        {children}
      </main>
    </>
  );
}
