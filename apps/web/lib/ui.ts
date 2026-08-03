// The product's whole visual vocabulary, composed from the tokens declared in
// app/globals.css. Screens append layout-only classes (grid, flex, order,
// w-full, gap, text-center) and never restyle a token inline.
//
// Why one file. v0.6 ran a house rule that every web track consume these
// tokens, and it held exactly as far as a test enforced it: components/landing
// came out with zero raw colour literals, while app/ and the rest of
// components/ accumulated around 600. F-21 fixed that by widening the gate,
// not by restating the rule. tests/design-system.test.ts holds this file to
// no raw Tailwind colour, no `dark:` variant, and no hex of its own;
// tests/token-vocabulary.test.ts holds the rest of the product to the same.
//
// The three rules a new token has to obey:
//
//   Colour. One accent (rose) carries every interactive and emphatic use.
//   Sage appears only on the Ready verdict. Alarm red appears only on
//   destructive actions and true errors. Three hues, three jobs. A fourth is
//   a review failure, not a preference.
//
//   Shape. Interactive is a full pill, surfaces are 12px (rounded-surface),
//   inputs are 8px (rounded-field). Mixed radius systems are only defensible
//   with a written rule; that is the rule.
//
//   Depth. Group with whitespace, then a hairline, then a ground change, in
//   that order. shadow-raise and shadow-float exist for the few things that
//   genuinely lift, and nothing else gets a shadow.
//
// What belongs here: colour, surface, border, radius, display type, and the
// interaction states that go with them. What stays inline at the call site:
// structure (grid, flex, order, width, gap), because that is layout, not
// design language.
//
// Spec: plans/2026-08-03-f21-design-spec.md (private workspace).

// --- Interaction ----------------------------------------------------------
//
// Hover, focus, and active states are CSS, never React. Paying a client
// component for a hover colour is how a server-rendered product becomes a
// client-rendered one by accident. The 150ms and the 0.98 press are the same
// everywhere so that pressing anything feels like pressing anything else.

const PRESS = "transition-[transform,background-color,color,border-color] duration-150 active:scale-[0.98]";

// --- Actions --------------------------------------------------------------

/** The dark pill. One per screen: the thing we are actually asking for. */
export const PRIMARY_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper ${PRESS} hover:bg-ink-muted disabled:cursor-wait disabled:opacity-50`;

/** The same action at landing scale: a first-screen CTA reads as an
 * invitation, not as a form control. */
export const CTA_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-full bg-ink px-7 py-3.5 text-center font-medium text-paper ${PRESS} hover:bg-ink-muted disabled:cursor-wait disabled:opacity-50`;

export const SECONDARY_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-full border border-field px-5 py-2.5 text-sm font-medium text-ink ${PRESS} hover:bg-paper-sunk disabled:cursor-wait disabled:opacity-50`;

/** Secondary at landing scale, sized to sit beside CTA_BUTTON without
 * out-shouting it. */
export const CTA_SECONDARY_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-full border border-field px-7 py-3.5 text-center font-medium text-ink ${PRESS} hover:bg-paper-sunk`;

/** A destructive confirmation. The only place alarm red is allowed on a
 * control, and it is deliberately not the default styling of a delete link:
 * the colour arrives at the confirmation, not at the invitation. */
export const DANGER_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-full bg-alarm px-5 py-2.5 text-sm font-medium text-paper ${PRESS} hover:opacity-90 disabled:cursor-wait disabled:opacity-50`;

export const LINK =
  "text-accent underline decoration-accent/35 underline-offset-4 transition-colors duration-150 hover:decoration-accent";

/** A link that should read as body text until it is wanted. */
export const QUIET_LINK =
  "underline decoration-hairline underline-offset-4 transition-colors duration-150 hover:decoration-ink";

// --- Type -----------------------------------------------------------------
//
// The serif carries language: headings, the verdict, pull quotes. Geist
// carries UI, body, and every number that sits in a column. Tracking is
// size-specific, never one value, because display type reads too loose as it
// grows and small caps read too tight.

/** One per page: the sentence that has to land in a glance. */
export const DISPLAY_HEADING = "font-serif text-display font-medium text-ink";

export const PAGE_HEADING = "font-serif text-page font-medium text-ink";

export const SECTION_HEADING = "font-serif text-section font-medium text-ink";

/** A heading inside a card or a row, where the serif would be too loud. */
export const SUB_HEADING = "font-medium text-ink";

/** The small uppercase label. Rationed: an eyebrow above every section is the
 * single most recognisable AI-design tell, so the landing holds itself to at
 * most one per three sections. Inside the app, where these are field labels
 * rather than decoration, that cap does not apply. */
export const LABEL = "text-label uppercase text-ink-faint";

/** Body text that is not the point of the screen. */
export const MUTED = "text-ink-muted";

/** Quieter still: microcopy under a CTA, captions, footnotes. */
export const SUBTLE = "text-sm text-ink-muted";
export const FINE_PRINT = "text-fine text-ink-faint";

/** The faint ink on its own, for the cases that need the colour without
 * inheriting a size. Every other faint token bundles one, which is right for
 * microcopy and wrong for anything display-scale. */
export const FAINT = "text-ink-faint";

/** A step number in a sequence, carrying the order the way an eyebrow used to.
 * Display-scale serif so it reads as a numeral rather than as a label, and
 * faint so it stays behind the step's own title. It exists as a token because
 * the alternative was a three-class composition repeated at a call site, which
 * is the exact drift this file was built to stop. */
export const STEP_NUMERAL = "font-serif text-page text-ink-faint";

/** The reading measure. Past about 68 characters the eye loses the line. */
export const PROSE_WIDTH = "max-w-[68ch]";

// --- The verdict ----------------------------------------------------------
//
// The product's output, and the one place its typography is the design.
//
// It is deliberately NOT a traffic light. Rendering "Not yet ready" in red
// would punish exactly the user this product is for, and colour-coded
// certainty is on the competitive dossier's AVOID list because it is how
// exam-band products manufacture confidence they have not earned. The verdict
// is carried by scale, position, and the threshold printed beside it. Sage
// marks Ready because arriving is worth marking; nothing else is coloured.

export const VERDICT_HEADING = "font-serif text-verdict font-medium text-ink";
export const VERDICT_READY = "font-serif text-verdict font-medium text-ready";

/** A score, anywhere it has to line up with another score. */
export const SCORE_NUMBER = "font-medium tabular-nums text-ink";
export const SCORE_DENOMINATOR = "text-sm tabular-nums text-ink-faint";

/** The reader's own words, quoted back as evidence. */
export const EVIDENCE_QUOTE =
  "border-l-2 border-hairline pl-4 text-sm italic leading-relaxed text-ink-muted";

// --- Surfaces -------------------------------------------------------------

/** The default bordered container: pricing card, framed screenshot, FAQ. */
export const CARD = "rounded-surface border border-hairline bg-surface";

/** A card that genuinely lifts off the page. Used sparingly, and never as a
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
 * Deliberately not red. These are true statements, not errors the user
 * caused, and colouring them as failures teaches the reader to distrust the
 * one place we do use alarm. */
export const NOTICE =
  "rounded-surface border border-hairline bg-paper-sunk px-4 py-3 text-sm text-ink-muted";

/** The one place we raise our voice: something the user must correct, or an
 * action that cannot be undone. */
export const ALARM_NOTICE =
  "rounded-surface border border-alarm/25 bg-alarm-wash px-4 py-3 text-sm text-alarm";

export const ERROR_TEXT = "text-sm text-alarm";

/** A floating layer: account and package menus. The only other shadow. */
export const MENU_PANEL =
  "absolute top-full z-20 mt-1.5 w-64 rounded-surface border border-hairline bg-surface p-1 text-sm shadow-float";

export const MENU_ROW =
  "block rounded-field px-3 py-2 transition-colors duration-150 hover:bg-paper-sunk";

// --- Chips ----------------------------------------------------------------
//
// Small, pill, uppercase, wide-tracked. One per state, and the state has to
// be real: a chip that says what the row already says is noise.

export const CHIP =
  "inline-flex items-center rounded-full bg-paper-sunk px-2.5 py-1 text-label uppercase text-ink-faint";

export const CHIP_ACCENT =
  "inline-flex items-center rounded-full bg-accent-wash px-2.5 py-1 text-label uppercase text-accent";

export const CHIP_READY =
  "inline-flex items-center rounded-full bg-ready-wash px-2.5 py-1 text-label uppercase text-ready";

// --- Tabs -----------------------------------------------------------------

export const TAB =
  "flex items-center border-b-2 border-transparent px-2.5 py-2.5 text-sm whitespace-nowrap text-ink-muted transition-colors duration-150 hover:text-ink";

export const TAB_ACTIVE =
  "flex items-center border-b-2 border-ink px-2.5 py-2.5 text-sm font-medium whitespace-nowrap text-ink";

// --- Tables ---------------------------------------------------------------

export const TABLE_HEAD = "text-label uppercase text-ink-faint";
export const TABLE_ROW = "border-t border-hairline";

// --- Inputs ---------------------------------------------------------------

export const FIELD =
  "w-full rounded-field border border-field bg-surface px-3 py-2.5 text-ink transition-colors duration-150 placeholder:text-ink-faint";

// --- Loading --------------------------------------------------------------
//
// Skeletons take the shape of what replaces them. A grey block that shares no
// proportion with the real content is a spinner with extra steps.

export const SKELETON = "animate-pulse rounded-field bg-paper-sunk";

// --- Empty values ---------------------------------------------------------
//
// A cell with nothing in it yet. A bare dash character was the old answer and
// it is banned typography; a short rule is the same idea drawn rather than
// typed, and the components that use it already carry the screen-reader
// sentence that says what the absence means.

export const EMPTY_RULE = "inline-block h-px w-6 bg-hairline align-middle";

// --- Framed screens -------------------------------------------------------
//
// Product screenshots are the proof layer of a features section, and framed
// ones read as product while raw crops read as stock art. Chrome first, then
// the capture.

export const SCREEN_FRAME =
  "overflow-hidden rounded-surface border border-hairline bg-surface shadow-raise";
export const SCREEN_CHROME =
  "flex items-center gap-1.5 border-b border-hairline bg-paper-sunk px-3 py-2";
export const SCREEN_DOT = "size-2 rounded-full bg-hairline";
export const SCREEN_BODY = "aspect-video w-full bg-paper-sunk";

/** A hatch that cannot be mistaken for a product screenshot. currentColor
 * keeps it legible without a variant, and it is a CSS value rather than a
 * utility class so Tailwind cannot silently drop it. */
export const PLACEHOLDER_HATCH =
  "repeating-linear-gradient(45deg, transparent, transparent 10px," +
  " color-mix(in srgb, currentColor 9%, transparent) 10px," +
  " color-mix(in srgb, currentColor 9%, transparent) 20px)";

// --- Rhythm ---------------------------------------------------------------

/** Vertical space between landing blocks. Scroll sections read as two to
 * three viewport heights, never denser. At the 110% root these are larger
 * than the numbers suggest. */
export const SECTION_GAP = "py-16 md:py-24";

/** The single blush field the brief allows, positioned by its parent. The
 * class itself lives in globals.css because it is a gradient, not a utility
 * composition. */
export const AMBIENT_WASH = "ambient-wash";
