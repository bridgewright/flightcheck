"use client";

import { motion, useReducedMotion } from "motion/react";

import {
  ENTRY_EASE,
  ENTRY_HIDDEN,
  ENTRY_SECONDS,
  ENTRY_SHOWN,
  REVEAL_ATTRIBUTE,
} from "./entry";

// The hero, arriving on mount instead of on scroll.
//
// Its one sentence is hierarchy: the claim should land before the rest of the
// page, and a block that is already in the viewport cannot use a scroll
// trigger to say so. No stagger, because the hero is a single moment and
// sequencing it into parts would argue with that.
//
// It uses the same curve and duration as the scroll entry rather than a second
// set of numbers, so the page has one entry vocabulary. Same prop rules as
// Reveal.tsx: children and a class string, nothing else, ever.

export default function MountReveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      {...REVEAL_ATTRIBUTE}
      className={className}
      initial={ENTRY_HIDDEN}
      animate={ENTRY_SHOWN}
      transition={{ duration: ENTRY_SECONDS, ease: ENTRY_EASE }}
    >
      {children}
    </motion.div>
  );
}
