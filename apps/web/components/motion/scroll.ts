// The hero cloud's scroll drift, as numbers rather than as a paragraph: the
// same shape as ./entry.ts, extended for the one scroll-linked motion the
// product has (F-88). Motion budget and its reasoning: DECISIONS 031 and 035;
// the route/drift pass is DECISIONS 063.
//
// Its one sentence: the cloud lags the scroll by a twentieth, which reads as
// depth, the light behind the page leaving more slowly than the words in
// front of it.
//
// Why these numbers, and why so few:
//
//   24 pixels of travel, total. The ask was "drift a little"; past a couple
//   dozen pixels a drift becomes a parallax feature performing for its own
//   sake, and the budget's no-showiness clause applies to distance as much as
//   to duration.
//
//   480 pixels of scroll to spend it, a 1:20 rate. Slow enough that the cloud
//   reads as sitting behind the page rather than attached to the reader's
//   finger; the travel completes while the hero is still on screen, so the
//   motion is never running where the cloud cannot be seen.
//
//   No easing and no clock. The reader's own scroll is the timeline
//   (scrub-linked, not time-based), so the map is linear and has no duration:
//   easing a direct manipulation makes it feel detached, and a duration would
//   make it lag input. The 0.3s budget governs clocked animations; this has
//   no clock to budget.
//
//   Clamped at both ends. Zero at and above the top (Safari reports negative
//   scrollY during rubber-band overscroll), and the full travel held past the
//   range, so the settled state at load is exactly the server render.

/** The cloud's whole travel. */
export const DRIFT_MAX_PX = 24;

/** The scroll distance that spends it. */
export const DRIFT_RANGE_PX = 480;

/** Scroll position in, translateY out. Pure, linear, clamped. */
export function driftY(scrollTop: number): number {
  if (scrollTop <= 0) return 0;
  if (scrollTop >= DRIFT_RANGE_PX) return DRIFT_MAX_PX;
  return (scrollTop / DRIFT_RANGE_PX) * DRIFT_MAX_PX;
}
