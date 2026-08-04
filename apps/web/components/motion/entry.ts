// The entry-motion budget, as numbers rather than as a paragraph.
//
// One module so the budget can be read in one place and cannot drift between
// leaves. Motion budget and its reasoning: DECISIONS 031 and 035.
//
// Every value here is the spec's, not a preference:
//
//   opacity 0 -> 1 with y 12 -> 0, because those are the two properties a
//   compositor can animate without touching layout. No top, no left, no width,
//   no height, anywhere in this directory. Twelve pixels rather than sixteen:
//   at a 14px root the whole page is smaller, and travel that was
//   proportionate before now reads as a lurch.
//
//   0.3s, not 0.5s. Measured off the reference, which uses 0.3s for every
//   transition it declares. A shorter entry reads as the page settling; a
//   longer one reads as the page performing.
//
//   cubic-bezier(0.25, 1, 0.5, 1) for transform and
//   cubic-bezier(0.165, 0.84, 0.44, 1) for colour and opacity, which are the
//   two curves the reference actually ships. Both decelerate into place.
//   Nothing overshoots: bounce belongs to motion that follows a gesture
//   carrying momentum, and this product has none.
//
//   0.05s between siblings. Enough that the order is felt, short enough that
//   the fourth item does not keep the reader waiting.
//
//   once: true, amount: 0.25. A block rises the first time a quarter of it is
//   on screen and then stays put. Re-animating on every scroll pass turns a
//   page into a toy.

/** The state a block enters from. */
export const ENTRY_HIDDEN = { opacity: 0, y: 12 };

/** The state it settles into, and the only state a reduced-motion reader sees. */
export const ENTRY_SHOWN = { opacity: 1, y: 0 };

export const ENTRY_SECONDS = 0.3;

/** Between siblings in a group. */
export const ENTRY_STAGGER_SECONDS = 0.05;

export const ENTRY_EASE: [number, number, number, number] = [0.25, 1, 0.5, 1];

/** The reference's colour and opacity curve, for anything that fades
 * without moving. Its transform curve is ENTRY_EASE above. */
export const FADE_EASE: [number, number, number, number] = [0.165, 0.84, 0.44, 1];

export const ENTRY_VIEWPORT = { once: true, amount: 0.25 };

/**
 * The attribute every animated element carries, and the reason it exists.
 *
 * motion renders `initial` into the server HTML, so the landing page ships 17
 * elements at `opacity: 0` with a `translateY`, and hydration is what reveals
 * them. Measured on the built page, not assumed. That is correct for the reader
 * we design for and it is flash-free, but it means a browser with JavaScript
 * disabled, or a page whose bundle fails to load, shows a landing page that is
 * blank while all of its text sits in the DOM. Crawlers and screen readers are
 * unaffected (opacity is not a hiding mechanism for either); sighted no-JS
 * readers see nothing.
 *
 * The fix is one rule, and it belongs in app/globals.css, which this track does
 * not own:
 *
 *   @media (scripting: none) {
 *     [data-reveal] { opacity: 1 !important; transform: none !important; }
 *   }
 *
 * An author `!important` beats an inline style, which is why this works against
 * what motion writes. The hook is here so that landing is a one-line change
 * rather than a hunt.
 */
export const REVEAL_ATTRIBUTE = { "data-reveal": "" };
