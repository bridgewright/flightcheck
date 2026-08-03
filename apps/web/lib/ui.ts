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
//   that order. One shadow exists, for the one thing that genuinely floats:
//   the account menu. A second was declared for cards that lift and no card
//   ever lifted, so it went.
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
// The interaction itself is the quiet part: a control is calm until you
// approach it and then commits. The reference does that with the label at 62%
// ink, and copying the number was a mistake here: our ink and ground are not
// its ink and ground, and ink/60 on paper measures 3.73:1 against a 4.5 bar
// while field/60 measures 1.99:1 against a 3.0 one. A secondary button has no
// fill, so that border is the only thing identifying it as a control, and it
// cleared the bar only while hovered.
//
// The same gesture, in tokens that pass at rest: ink-muted (5.95:1) going to
// ink, and field (3.53:1) going to ink. Quiet is a step down the ink ramp, not
// a transparency.
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
  `inline-flex items-center justify-center gap-2 rounded-control border border-field px-4 py-2 text-ink-muted ${ACTION_LABEL} ${PRESS} hover:border-ink hover:text-ink disabled:cursor-wait disabled:opacity-50`;

export const CTA_SECONDARY_BUTTON =
  `inline-flex items-center justify-center gap-2.5 rounded-control border border-field px-5 py-2 text-center text-ink-muted ${ACTION_LABEL} ${PRESS} hover:border-ink hover:text-ink`;

/** A destructive confirmation. The one place alarm belongs on a control, and
 * it arrives at the confirmation rather than at the invitation. */
export const DANGER_BUTTON =
  `inline-flex items-center justify-center gap-2 rounded-control bg-alarm px-4 py-2 text-paper ${ACTION_LABEL} ${PRESS} disabled:cursor-wait disabled:opacity-50`;

/** The link. One token, because the two that were here differed only in a
 * decoration neither reader could see: `decoration-ink/25` was 1.61:1 against
 * paper and `decoration-hairline` was 1.23:1. Both were the sole thing marking
 * the link as a link, and the second was worse than an accident: `hairline`
 * is declared in globals.css as decorative and deliberately under 3:1, so a
 * link was resting its whole affordance on a token that says in writing it
 * cannot carry one.
 *
 * `field` is the token that exists for this: a boundary that has to be
 * visible, asserted at 3:1 or better on every ground. Hover still goes to full
 * ink, so the distinction the pair was reaching for survives as a state rather
 * than as two names. */
export const LINK =
  "underline decoration-field underline-offset-4 transition-colors duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)] hover:decoration-ink";

/** The one sentence in a judge's rationale that carries the finding.
 *
 * Bold and underlined on the user's request, so the point of a paragraph is
 * findable without reading all of it. It was written inline as
 * `underline decoration-hairline decoration-1`, which put the emphasis mark at
 * 1.23:1 against paper: `hairline` is declared in globals.css as decorative
 * and deliberately under 3:1, so it is the one token that cannot carry an
 * emphasis. It also sat at the same colour and offset as the clickable
 * `<summary>` links on the same screen, so a block of prose and a control were
 * marked identically and told apart only by line thickness.
 *
 * `field` is visible (3.53:1 on paper) and is not what any link uses at this
 * weight, so the two read as different things. */
export const KEY_FINDING =
  "font-medium text-ink underline decoration-field decoration-1 underline-offset-4";

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

// --- Page containers ------------------------------------------------------
//
// Shell renders these, and so does every loading.tsx that stands in for a
// Shell page. That is the whole reason they are here: the four skeletons were
// written against `max-w-2xl` and `max-w-5xl` with a bare `px-6`, the batch
// moved Shell to `max-w-reading` / `max-w-shell` with responsive padding and
// widened `- -container-reading` from 46rem to 64rem, and the skeletons stayed
// behind. A reader clicking into a report watched the column jump 308px wider
// the moment content arrived, which is the exact reflow a skeleton exists to
// prevent. Each file said in its own comment that it matched the real page.

/** Padding and centring shared by every page column. */
const PAGE_GUTTER = "mx-auto w-full px-6 pt-10 pb-12 sm:px-10 lg:px-16 xl:px-24";

/** The reading column most screens use. */
export const MAIN_READING = `${PAGE_GUTTER} max-w-reading`;

/** Side-by-side or full-bleed content: landing, tables. Matches the top bar. */
export const MAIN_WIDE = `${PAGE_GUTTER} max-w-shell`;

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

/** The chip's geometry and type, exported so a screen that needs a new tone
 * composes one instead of hand-rolling the shell. Two screens hand-rolled it
 * while this was private, and both dropped `font-mono` in the process, so the
 * same failure state rendered in sans on one screen and mono on another. */
export const CHIP_SHELL =
  "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-label uppercase";

/** A section label. The default. */
export const CHIP_SKY = `${CHIP_SHELL} bg-sky text-ink`;

/** Work in progress: scoring, waiting, a session mid-flight. */
export const CHIP_BLUSH = `${CHIP_SHELL} bg-blush text-ink`;

/** A state with no colour of its own. */
export const CHIP = `${CHIP_SHELL} bg-paper-sunk text-ink-faint`;

/** Arrived: the Ready verdict, and nothing else. */
export const CHIP_READY = `${CHIP_SHELL} bg-ready-wash text-ready`;

/** A failure that is ours: a session we could not score, a scoring run that
 * closed without a result. Alarm belongs here because the product broke, not
 * because the reader did badly. A low score never takes this. */
export const CHIP_ALARM = `${CHIP_SHELL} bg-alarm-wash text-alarm`;

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

// There is no raised card. One was written here on the reasoning that a system
// should offer elevation "for the few things that genuinely lift", and then
// nothing lifted: every grouping in the product turned out to want whitespace,
// a hairline, or a ground change. A token nothing renders is a claim the design
// makes that no screen has to keep, so it went, and `- -shadow-raise` with it.
// The floating shadow survives because the account menu genuinely floats.

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

// The framed-screenshot tokens and the placeholder hatch were here, and are
// gone with the components that used them. Nothing in the product renders a
// simulated browser chrome now, which is the point: the landing shows what the
// product says rather than a picture of a screen it has not captured.

/** The hero cloud. Full-bleed and *absolute*, so its edges fall off-screen
 * instead of drawing a rectangle, and so it stays in the hero: `fixed` was the
 * first attempt and it tinted every screen the reader scrolled to. The class
 * lives in globals.css because it is an image reference rather than a utility
 * composition. One element per page, in the hero.
 *
 * It is not a CSS gradient and the stylesheet declares none. The product's one
 * gradient is outside this file, in `hero-bloom.svg`'s radial stops. */
export const HERO_BLOOM = "hero-bloom";

/** Vertical space between landing blocks. The reference's pages are mostly
 * air; at the 14px root these numbers are smaller than they look, so they are
 * deliberately larger in ratio than the old scale. */
export const SECTION_GAP = "py-20 md:py-28";
