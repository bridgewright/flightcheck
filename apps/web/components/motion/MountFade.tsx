"use client";

import { motion, useReducedMotion } from "motion/react";

import { ENTRY_SECONDS, FADE_EASE, REVEAL_ATTRIBUTE } from "./entry";

// A block that fades in once on mount, without moving.
//
// Its one sentence: a value that changed while the reader watched arrives
// instead of teleporting. PollRefresh swaps server-rendered content
// wholesale, so a status that flips between two renders would otherwise
// simply be different the next time the eye lands on it. Callers key this
// leaf on the status value: React remounts the cell when the status changes
// and the entry plays once, and an unchanged key never remounts, so an idle
// poll tick replays nothing.
//
// FADE_EASE and no travel, because this is not an entrance in reading order:
// it is the same cell it was, with a new value, and giving it the entry's
// rise would claim a new thing arrived rather than a known thing changed.
//
// Same prop rules as Reveal: presentational values only, nothing else, ever.

export default function MountFade({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  // Not a shorter fade: no fade. The new value, already settled.
  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      {...REVEAL_ATTRIBUTE}
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: ENTRY_SECONDS, ease: FADE_EASE }}
    >
      {children}
    </motion.div>
  );
}
