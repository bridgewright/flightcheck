"use client";

import { motion, useReducedMotion } from "motion/react";

import {
  ENTRY_EASE,
  ENTRY_SECONDS,
  ENTRY_VIEWPORT,
  REVEAL_ATTRIBUTE,
} from "./entry";

// The gauge's reading, sweeping to its place once.
//
// Its one sentence: the score is a measurement, and an instrument whose
// reading sweeps in the first time you see it says "measured" in a way a mark
// that is simply there cannot. One shot, first view only, on the shared entry
// numbers: an instrument that re-measures every time you scroll past is a toy,
// and a client leaf keeps its state across PollRefresh's server re-renders,
// which is what guarantees a poll tick never replays this.
//
// The shape is three nested spans, each for a stated reason:
//
//   The outer motion span is the viewport observer and never moves. The mover
//   starts translated most of the way off the rail, so observing the mover
//   itself would leave its visible fraction under ENTRY_VIEWPORT's amount on
//   high readings and the sweep would never fire.
//
//   The middle span is the same right-anchored positioner the gauge uses for
//   its static marks: right-full parks the wrapper's right edge at the rail's
//   start, translateX(percent%) walks it to the reading. Static, inline, and
//   never animated.
//
//   The inner motion span carries the animation, x from -percent% back to 0,
//   so the settled state is no transform at all. That is load-bearing: both
//   globals.css backstops write `transform: none !important` on [data-reveal],
//   and for a no-JS reader that IS the final render. A sweep built as scaleX
//   toward a fraction would settle at a meaningful transform, and the backstop
//   would show that reader a full bar: a wrong number, not a missing nicety.
//
// Same prop rules as Reveal: presentational values only, nothing else, ever.

export default function Sweep({
  percent,
  children,
}: {
  percent: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const place = { transform: `translateX(${percent}%)` };
  const anchor = "absolute inset-y-0 right-full w-full";

  // Not a shorter sweep: no sweep. The settled reading, already in place.
  if (reduce) {
    return (
      <span className={anchor} style={place}>
        {children}
      </span>
    );
  }

  return (
    <motion.span
      className="absolute inset-0"
      initial="hidden"
      whileInView="shown"
      viewport={ENTRY_VIEWPORT}
    >
      <span className={anchor} style={place}>
        <motion.span
          {...REVEAL_ATTRIBUTE}
          className="absolute inset-0"
          variants={{
            hidden: { x: `${-percent}%`, opacity: 0 },
            shown: { x: "0%", opacity: 1 },
          }}
          transition={{ duration: ENTRY_SECONDS, ease: ENTRY_EASE }}
        >
          {children}
        </motion.span>
      </span>
    </motion.span>
  );
}
