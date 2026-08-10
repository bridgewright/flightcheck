"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

import { REVEAL_ATTRIBUTE } from "./entry";
import { driftY } from "./scroll";

// The hero cloud, lagging the scroll (F-88, DECISIONS 063).
//
// Its one sentence: the cloud lags the scroll by a twentieth, which reads as
// depth, the light behind the page leaving more slowly than the words in
// front of it.
//
// Every magnitude lives in ./scroll.ts, where it is unit-tested; this leaf
// declares no number of its own. useScroll and useTransform keep the motion
// value off the React render path entirely: motion subscribes passively,
// batches on animation frames, and writes the transform to the element
// directly, so a scroll never re-renders this tree and never reads layout.
//
// The settled state is the server render. driftY(0) is 0, so the HTML ships
// the cloud exactly where a reader without JavaScript, before hydration, or
// with reduced motion will keep it; the reduce branch renders a plain div,
// and the data-reveal backstops force `transform: none` for the readers the
// client never reaches. Decorative either way, so the aria-hidden lives here
// rather than at the call site.
//
// Same prop rules as Reveal: presentational values only, nothing else, ever.

export default function Drift({
  className,
}: {
  className?: string;
}) {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, driftY);

  // Not a smaller drift: no drift. The cloud, already settled.
  if (reduce) {
    return <div aria-hidden="true" className={className} />;
  }

  return (
    <motion.div
      {...REVEAL_ATTRIBUTE}
      aria-hidden="true"
      className={className}
      style={{ y }}
    />
  );
}
