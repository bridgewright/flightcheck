// The entry-motion budget, as numbers rather than as a paragraph.
//
// One module so the budget can be read in one place and cannot drift between
// leaves. Spec: plans/2026-08-03-f21-design-spec.md 6 (private workspace).
//
// Every value here is the spec's, not a preference:
//
//   opacity 0 -> 1 with y 16 -> 0, because those are the two properties a
//   compositor can animate without touching layout. No top, no left, no width,
//   no height, anywhere in this directory.
//
//   0.5s on [0.16, 1, 0.3, 1]: a fast start that decelerates into place, which
//   is what "arriving" looks like. Nothing overshoots, because bounce belongs
//   to motion that follows a gesture carrying momentum and this product has
//   none.
//
//   0.06s between siblings. Enough that the order is felt, short enough that
//   the fourth item does not keep the reader waiting.
//
//   once: true, amount: 0.25. A block rises the first time a quarter of it is
//   on screen and then stays put. Re-animating on every scroll pass turns a
//   page into a toy.

/** The state a block enters from. */
export const ENTRY_HIDDEN = { opacity: 0, y: 16 };

/** The state it settles into, and the only state a reduced-motion reader sees. */
export const ENTRY_SHOWN = { opacity: 1, y: 0 };

export const ENTRY_SECONDS = 0.5;

/** Between siblings in a group. */
export const ENTRY_STAGGER_SECONDS = 0.06;

export const ENTRY_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

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
