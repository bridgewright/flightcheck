// Shared style tokens for the neutral baseline. One definition instead of a
// per-page copy so the F-21 design pass edits a single file. Pages append
// layout-only classes (w-full, self-start, text-center) — never restyle the
// token inline.
//
// v0.6 widened this from two tokens to the set the public surface actually
// needs. The F-21 pass re-points these to a light-first pastel system with a
// ~10% scale-up, and the test of whether that hedge worked is simple: F-21
// should be able to rewrite the strings in this file and have the landing,
// pricing, checkout, legal, sample-report, and login screens follow without
// one component being re-authored.
//
// Enforced, not hoped for: the "styles from the token module" cases in
// tests/landing-copy-register.test.ts fail on a raw colour utility or a
// `dark:` variant anywhere under components/landing/. That test covers the
// landing components only — the app/ screens above were brought onto tokens
// by hand and are not yet gated, so a raw literal reintroduced in app/
// checkout, legal, or sample-report would pass CI. Widening the scan to those
// files is a v0.7 item.
//
// Rule of thumb for adding one: colour, surface, border, and display type
// belong here. Structure (grid, flex, order, w-full, gap) stays inline at the
// call site, because that is layout, not design language.

// --- Actions -------------------------------------------------------------

export const PRIMARY_BUTTON =
  "rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-neutral-900";

// The same action at landing scale: a first-screen CTA reads as an invitation,
// not as a form control.
export const CTA_BUTTON =
  "inline-block rounded-md bg-neutral-900 px-6 py-3 text-center font-medium text-white disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-neutral-900";

export const SECONDARY_BUTTON =
  "rounded-md border border-neutral-300 px-4 py-2.5 font-medium disabled:cursor-wait disabled:opacity-50 dark:border-neutral-700";

// Secondary at landing scale, to sit beside CTA_BUTTON without out-shouting it.
export const CTA_SECONDARY_BUTTON =
  "inline-block rounded-md border border-neutral-300 px-6 py-3 text-center font-medium dark:border-neutral-700";

export const LINK = "underline underline-offset-4";

// --- Type ----------------------------------------------------------------

// Display heading: one per page, the sentence that has to land in a glance.
export const DISPLAY_HEADING =
  "text-3xl font-bold tracking-tight text-balance md:text-5xl";

export const PAGE_HEADING = "text-2xl font-bold tracking-tight text-balance";

export const SECTION_HEADING =
  "text-xl font-bold tracking-tight text-balance md:text-2xl";

export const LABEL =
  "text-[10px] font-semibold tracking-wide text-neutral-500 uppercase";

// Body text that is not the point of the screen.
export const MUTED = "text-neutral-600 dark:text-neutral-400";

// Quieter still: microcopy under a CTA, captions, footnotes.
export const SUBTLE = "text-sm text-neutral-500";
export const FINE_PRINT = "text-xs text-neutral-500";

// --- Surfaces ------------------------------------------------------------

// The default bordered container: pricing card, framed screenshot, FAQ row.
export const CARD = "rounded-md border border-neutral-300 dark:border-neutral-700";

// A filled surface for content that is a sample, an aside, or a placeholder —
// visibly a step back from the page it sits on.
export const PANEL =
  "rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900";

// Hairlines between sections and rows.
export const DIVIDER = "border-neutral-200 dark:border-neutral-800";
export const DIVIDE_Y = "divide-y divide-neutral-200 dark:divide-neutral-800";

// A calm notice: the honest degraded state, a "nothing was charged" line.
// Deliberately not red — these are true statements, not errors the user caused.
export const NOTICE =
  "rounded-md border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-900";

// The one place we do raise our voice: input the user must correct.
export const ERROR_TEXT = "text-sm text-red-600 dark:text-red-400";

// --- Inputs --------------------------------------------------------------

export const FIELD =
  "w-full rounded-md border border-neutral-300 px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900";

// --- Framed screens ------------------------------------------------------
//
// Product screenshots are the proof layer of a features section, and framed
// ones read as product while raw crops read as stock art. Chrome first, then
// the capture.

export const SCREEN_FRAME =
  "overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700";
export const SCREEN_CHROME =
  "flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-100 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900";
export const SCREEN_DOT = "size-2 rounded-full bg-neutral-300 dark:bg-neutral-700";
export const SCREEN_BODY = "aspect-video w-full bg-neutral-50 dark:bg-neutral-900";

// A hatch that cannot be mistaken for a product screenshot. currentColor
// keeps it legible in both themes without a variant, and it is a CSS value
// rather than a utility class so Tailwind cannot silently drop it.
export const PLACEHOLDER_HATCH =
  "repeating-linear-gradient(45deg, transparent, transparent 10px," +
  " color-mix(in srgb, currentColor 9%, transparent) 10px," +
  " color-mix(in srgb, currentColor 9%, transparent) 20px)";

// --- Rhythm --------------------------------------------------------------

// Vertical space between landing blocks. Scroll sections read as two-to-three
// viewport heights, never denser (the polish bar the market sets).
export const SECTION_GAP = "py-14 md:py-20";
