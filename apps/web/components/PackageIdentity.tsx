import CompanyMark from "@/components/CompanyMark";
import { packageIdentityDecision } from "@/components/package-identity";
import { CHIP } from "@/lib/ui";

// The small identity that says which company a package is for (F-56), on
// every surface that names one. A server component: the only client part is
// CompanyMark, which already hides itself when the favicon fails to load.
//
// Two seats, two variants:
//
//   "chip": the CHIP token pill, for one-line page subtitles where the
//   identity stands on its own beside or under a heading.
//
//   "row": bare, for the dense top-bar switcher rows and trigger. Not a chip
//   there, decided against lib/ui.ts rather than by taste: CHIP's ground is
//   bg-paper-sunk and MENU_ROW's hover is hover:bg-paper-sunk, so a chip
//   inside a hovered menu row would dissolve into its own background, and
//   CHIP_SHELL's mono uppercase at text-label size would shout inside a
//   text-fine row. The row variant inherits the seat's type and colour and
//   contributes only the mark, the name, and truncation.

const VARIANT_CLASSES = {
  chip: `${CHIP} gap-1.5`,
  row: "inline-flex min-w-0 items-center gap-1.5",
} as const;

export type PackageIdentityVariant = keyof typeof VARIANT_CLASSES;

export default function PackageIdentity({
  packageId,
  company,
  jdUrl,
  variant,
}: {
  packageId: string;
  /** The company the rubric named, straight from the package row. */
  company: string | null | undefined;
  /** The pasted JD URL, straight from the package row; it decides the mark. */
  jdUrl: string | null | undefined;
  variant: PackageIdentityVariant;
}) {
  const identity = packageIdentityDecision(company, jdUrl);
  // Absent rather than blank: see packageIdentityDecision.
  if (identity === null) return null;
  return (
    <span className={VARIANT_CLASSES[variant]}>
      {identity.showMark ? <CompanyMark packageId={packageId} /> : null}
      <span className="truncate">{identity.company}</span>
    </span>
  );
}
