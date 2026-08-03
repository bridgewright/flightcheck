// The product's whole visual vocabulary, composed from the tokens declared in
// app/globals.css. Screens append layout-only classes (grid, flex, order,
// w-full, gap, text-center) and never restyle a token inline.
//
// Why one file. v0.6 ran a house rule that every web track consume these
// tokens, and it held exactly as far as a test enforced it: components/landing
// came out with zero raw colour literals while the rest of the product
// accumulated around 600. F-21 fixed that by widening the gate, not by
// restating the rule. tests/design-system.test.ts holds this file to no raw
// Tailwind colour, no `dark:` variant, and no hex of its own.
//
// The four rules a new token has to obey:
//
//   Weight. Everything is 400. The reference builds hierarchy from size,
//   space, and colour rather than from boldness, and that is most of why it
//   reads light. `font-medium` appears only where a label has to separate from
//   the body text immediately beside it.
//
//   Shape. A CONTROL IS NOT A FULL PILL: buttons are 7px rounded rectangles
//   (rounded-control), surfaces are 8.75px (rounded-surface), and only the
//   small label chips are fully round. An earlier pass made every button a
//   full pill and that is a large part of why they read as thick.
//
//   Colour. Sky labels a section, blush marks work in progress, and both carry
//   plain ink as their text. Sage marks an affirmative state that was earned:
//   the Ready verdict and the live microphone indicator. Alarm marks
//   destructive actions and true errors. Nothing else is coloured.
//
//   Depth. Group with whitespace, then a hairline, then a ground change, in
//   that order. Two shadows exist for the few things that genuinely lift.
//
// Spec: plans/2026-08-03-f21-design-spec.md (private workspace).

// --- Interaction ----------------------------------------------------------
//
// Hover, focus, and active states are CSS, never React. Paying a client
// component for a hover colour is how a server-rendered product becomes a
// client-rendered one by accident.

// Measured off the reference rather than chosen: it transitions
// background-color, color, and border-color over 0.3s on
// cubic-bezier(0.165, 0.84, 0.44, 1), and it animates nothing else on a
// control. No scale on press, no shadow lift, no size change.
//
// The interaction itself is the quiet part: the reference draws a control's
// label at 62% ink and takes it to full ink on hover, so a button is calm
// until you approach it and then commits. That is the whole gesture.
const EASE_UI = "ease-[cubic-bezier(0.165,0.84,0.44,1)]";
const PRESS = `transition-[background-color,color,border-color,opacity] duration-300 ${EASE_UI}`;

// --- Actions --------------------------------------------------------------
//
// The primary control is small: about 27px tall, a 10.5px uppercase mono
// label, 0.1em tracking, 7px corners. Measured off the reference rather than
// chosen. The label is set in mono because that is what makes a control at
// this size read as a control rather than as a stray line of text.

const ACTION_LABEL = "font-mono text-action uppercase";

/** The dark control. One per screen: the thing we are actually asking for. */
export const PRIMARY_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-control bg-ink px-4 py-2 text-paper ${ACTION_LABEL} ${PRESS} hover:bg-ink-muted disabled:cursor-wait disabled:opacity-50`;

/** The same action on a landing block. Wider padding, same height and weight:
 * a first-screen CTA earns emphasis from space around it, not from mass. */
export const CTA_BUTTON =
  `inline-flex items-center justify-center gap-2.5 rounded-control bg-ink px-5 py-2 text-center text-paper ${ACTION_LABEL} ${PRESS} hover:bg-ink-muted disabled:cursor-wait disabled:opacity-50`;

export const SECONDARY_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-control border border-field/60 px-4 py-2 text-ink/60 ${ACTION_LABEL} ${PRESS} hover:border-field hover:text-ink disabled:cursor-wait disabled:opacity-50`;

export const CTA_SECONDARY_BUTTON =
  `inline-flex items-center justify-center gap-2.5 rounded-control border border-field/60 px-5 py-2 text-center text-ink/60 ${ACTION_LABEL} ${PRESS} hover:border-field hover:text-ink`;

/** A destructive confirmation. The one place alarm belongs on a control, and
 * it arrives at the confirmation rather than at the invitation. */
export const DANGER_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-control bg-alarm px-4 py-2 text-paper ${ACTION_LABEL} ${PRESS} disabled:cursor-wait disabled:opacity-50`;

export const LINK =
  "underline decoration-ink/25 underline-offset-4 transition-colors duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] hover:decoration-ink";

/** A link that should read as body text until it is wanted. */
export const QUIET_LINK =
  "underline decoration-hairline underline-offset-4 transition-colors duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] hover:decoration-ink";

// --- Type -----------------------------------------------------------------
//
// Every step carries its own size, leading, tracking, and weight from
// globals.css, so a heading is one class rather than four.

/** One per page: the sentence that has to land in a glance. */
export const DISPLAY_HEADING = "text-display text-ink";

export const PAGE_HEADING = "text-page text-ink";

export const SECTION_HEADING = "text-section text-ink";

/** A heading inside a card or a row. Separated from the body beside it by
 * weight, because at this size nothing else would separate it. */
export const SUB_HEADING = "font-medium text-ink";

/** Body text that is not the point of the screen. */
export const MUTED = "text-ink-muted";

/** Quieter still: microcopy under a control, captions, footnotes. */
export const SUBTLE = "text-fine text-ink-muted";
export const FINE_PRINT = "text-fine text-ink-faint";

/** The faint ink on its own, for cases that need the colour without a size. */
export const FAINT = "text-ink-faint";

/** The reading measure. Past about 68 characters the eye loses the line. */
export const PROSE_WIDTH = "max-w-[68ch]";

// --- Labels and chips -----------------------------------------------------
//
// The pastel label pill is the reference's signature element and the shape is
// half of it: about 17px tall, 9.6px mono uppercase, fully round, sitting on
// its own above a section rather than inside a card.
//
// They are rationed. An eyebrow above every section is the most recognisable
// AI-design tell there is, so the landing holds itself to at most one per
// three sections. Inside the signed-in app, where these are field labels
// rather than decoration, the cap does not apply.

const CHIP_SHELL =
  "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-label uppercase";

/** A section label. The default. */
export const CHIP_SKY = `${CHIP_SHELL} bg-sky text-ink`;

/** Work in progress: scoring, waiting, a session mid-flight. */
export const CHIP_BLUSH = `${CHIP_SHELL} bg-blush text-ink`;

/** A state with no colour of its own. */
export const CHIP = `${CHIP_SHELL} bg-paper-sunk text-ink-faint`;

/** Arrived: the Ready verdict, and nothing else. */
export const CHIP_READY = `${CHIP_SHELL} bg-ready-wash text-ready`;

/** A bare label with no pill, for field labels and table heads. */
export const LABEL = "font-mono text-label uppercase text-ink-faint";

/** A step number in a sequence, carrying the order the way an eyebrow used to.
 *
 * The reference draws exactly this: a small square chip, ink at six percent,
 * with the numeral set in mono. It replaces both the banned "STEP 1" uppercase
 * label and the oversized serif numeral that stood here for a day. The number
 * is small on purpose: it marks position, it is not the content. */
export const STEP_NUMERAL =
  "inline-flex size-5 shrink-0 items-center justify-center rounded-control bg-ink/6 font-mono text-label text-ink";

// --- The verdict ----------------------------------------------------------
//
// The product's output, and the one place its typography is the design.
//
// Deliberately NOT a traffic light. Rendering "Not yet ready" in red would
// punish exactly the reader this product exists for, and colour-coded
// certainty is on the competitive dossier's AVOID list because it is how
// exam-band products manufacture confidence they have not earned. The verdict
// is carried by scale, position, and the threshold printed beside it. Sage
// marks Ready because arriving is worth marking; nothing else is coloured.

export const VERDICT_HEADING = "text-verdict text-ink";
export const VERDICT_READY = "text-verdict text-ready";

/** A score, anywhere it has to line up with another score. */
export const SCORE_NUMBER = "tabular-nums text-ink";
export const SCORE_DENOMINATOR = "text-fine tabular-nums text-ink-faint";

/** The reader's own words, quoted back as evidence. */
export const EVIDENCE_QUOTE =
  "border-l border-hairline pl-3 text-fine italic text-ink-muted";

// --- Surfaces -------------------------------------------------------------

/** The default bordered container: pricing card, framed screenshot, FAQ row. */
export const CARD = "rounded-surface border border-hairline bg-surface";

/** A card that genuinely lifts off the page. Used sparingly, never as a
 * default: most grouping wants whitespace, not elevation. */
export const CARD_RAISED =
  "rounded-surface border border-hairline bg-surface shadow-raise";

/** A filled surface for content that is a sample, an aside, or a placeholder:
 * visibly a step back from the page it sits on. */
export const PANEL = "rounded-surface border border-hairline bg-paper-sunk";

/** Hairlines between sections and rows. */
export const DIVIDER = "border-hairline";
export const DIVIDE_Y = "divide-y divide-hairline";

/** A calm notice: the honest degraded state, a "nothing was charged" line.
 * Deliberately not red. These are true statements, not errors the reader
 * caused, and colouring them as failures teaches distrust of the one place we
 * do use alarm. */
export const NOTICE =
  "rounded-surface border border-hairline bg-paper-sunk px-3 py-2.5 text-fine text-ink-muted";

/** The one place we raise our voice: something to correct, or an action that
 * cannot be undone. */
export const ALARM_NOTICE =
  "rounded-surface border border-alarm/25 bg-alarm-wash px-3 py-2.5 text-fine text-alarm";

export const ERROR_TEXT = "text-fine text-alarm";

/** A floating layer: account and package menus. The only other shadow. */
export const MENU_PANEL =
  "absolute top-full z-20 mt-1.5 w-60 rounded-surface border border-hairline bg-surface p-1 text-fine shadow-float";

export const MENU_ROW =
  "block rounded-control px-2.5 py-1.5 transition-colors duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] hover:bg-paper-sunk";

// --- Tabs -----------------------------------------------------------------

export const TAB =
  "flex items-center border-b border-transparent px-2 py-2 text-fine whitespace-nowrap text-ink-muted transition-colors duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] hover:text-ink";

export const TAB_ACTIVE =
  "flex items-center border-b border-ink px-2 py-2 text-fine whitespace-nowrap text-ink";

// --- Tables ---------------------------------------------------------------

export const TABLE_HEAD = "font-mono text-label uppercase text-ink-faint";
export const TABLE_ROW = "border-t border-hairline";

// --- Inputs ---------------------------------------------------------------

export const FIELD =
  "w-full rounded-control border border-field bg-surface px-2.5 py-2 text-ink transition-colors duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] placeholder:text-ink-faint";

// --- Loading --------------------------------------------------------------
//
// Skeletons take the shape of what replaces them. A grey block that shares no
// proportion with the real content is a spinner with extra steps.

export const SKELETON = "animate-pulse rounded-control bg-paper-sunk";

// --- Empty values ---------------------------------------------------------
//
// A cell with nothing in it yet. A bare dash was the old answer and it is
// banned typography; a short rule is the same idea drawn rather than typed,
// and the components using it already carry the screen-reader sentence that
// says what the absence means.

export const EMPTY_RULE = "inline-block h-px w-5 bg-hairline align-middle";

// --- Framed screens -------------------------------------------------------
//
// Product screenshots are the proof layer of a features section, and framed
// ones read as product while raw crops read as decoration. Chrome first, then
// the capture.

export const SCREEN_FRAME =
  "overflow-hidden rounded-surface border border-hairline bg-surface";
export const SCREEN_CHROME =
  "flex items-center gap-1.5 border-b border-hairline bg-paper-sunk px-2.5 py-1.5";
export const SCREEN_DOT = "size-1.5 rounded-full bg-hairline";
export const SCREEN_BODY = "aspect-video w-full bg-paper-sunk";

/** A hatch that cannot be mistaken for a product screenshot. currentColor
 * keeps it legible without a variant, and it is a CSS value rather than a
 * utility class so Tailwind cannot silently drop it. */
export const PLACEHOLDER_HATCH =
  "repeating-linear-gradient(45deg, transparent, transparent 10px," +
  " color-mix(in srgb, currentColor 8%, transparent) 10px," +
  " color-mix(in srgb, currentColor 8%, transparent) 20px)";

// --- Rhythm ---------------------------------------------------------------

/** The hero cloud, and the only gradient in the product. Full-bleed and
 * fixed, so its edges fall off-screen instead of drawing a rectangle; the
 * class itself lives in globals.css because it is a gradient, not a utility
 * composition. One element per page, in the hero. */
export const HERO_BLOOM = "hero-bloom";

/** Vertical space between landing blocks. The reference's pages are mostly
 * air; at the 14px root these numbers are smaller than they look, so they are
 * deliberately larger in ratio than the old scale. */
export const SECTION_GAP = "py-20 md:py-28";
