// Shared style tokens for the neutral baseline. One definition instead of a
// per-page copy so the F-21 design pass edits a single file. Pages append
// layout-only classes (w-full, self-start, text-center) — never restyle the
// token inline.

export const PRIMARY_BUTTON =
  "rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-neutral-900";

export const LABEL =
  "text-[10px] font-semibold tracking-wide text-neutral-500 uppercase";
