// Which surfaces the route-enter canvas covers, decided here so the exclusion
// is a tested property rather than a habit (F-88, DECISIONS 063).
//
// The route enter itself lives in app/globals.css as a CSS animation scoped
// under the class this module names: `.route-canvas main`. CSS rather than a
// client component, because the enter must play before hydration, with
// JavaScript off, and on every navigation, and a stylesheet does all three
// for free. Its numbers are not declared twice: tests/route-motion.test.ts
// reads the stylesheet and holds its duration and curve equal to
// ENTRY_SECONDS and FADE_EASE in ./entry.ts.
//
// Its one sentence: a new screen resolves onto a surface that never left.
// The chrome around <main> repaints identical pixels and holds still, so only
// the content is seen to change.

/** The scope class app/template.tsx applies. One name, used by the template,
 * the stylesheet, and the pins, all through this constant. */
export const ROUTE_CANVAS = "route-canvas";

/** The session room, at its one address. User-excluded surface (F-50): an
 * interview gets a still screen, so the canvas class is withheld there and
 * nothing under it animates on entry. */
const STILL_SURFACE = /^\/sessions\/[^/]+\/room\/?$/;

export function isStillSurface(pathname: string): boolean {
  return STILL_SURFACE.test(pathname);
}

/** The template's whole decision: the canvas class, or nothing for the room. */
export function routeCanvasClass(pathname: string): string | undefined {
  return isStillSurface(pathname) ? undefined : ROUTE_CANVAS;
}
