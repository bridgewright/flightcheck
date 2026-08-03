"use client";

import { motion, useReducedMotion } from "motion/react";

import {
  ENTRY_EASE,
  ENTRY_HIDDEN,
  ENTRY_SECONDS,
  ENTRY_SHOWN,
  ENTRY_VIEWPORT,
  REVEAL_ATTRIBUTE,
} from "./entry";

// One block, rising once as the reader reaches it.
//
// Why it exists at all: the landing page is an argument in order, and a block
// that arrives as you get to it says "read this next" in a way a static page
// cannot. That is the one sentence this animation has to be able to give, and
// it is the reason nothing else on the page moves.
//
// Why it is shaped like this. The landing components stay server components;
// only this wrapper is a client island, and it receives children already
// rendered on the server. So the props are the whole interface: children, a
// delay in seconds, and a class string. Nothing else may be added. A viewer, a
// package, a session, or a capability token passed to a component in this
// directory would be serialized into the page's RSC payload, which is the
// exact leak commit 79838fd closed on the signed-in screens. An animation is
// not a reason to reopen it, and tests/landing-motion.test.ts holds the line.

export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();

  // Not "a shorter animation": no animation. The reader asked the operating
  // system for stillness, so they get the settled state and a plain div.
  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      {...REVEAL_ATTRIBUTE}
      className={className}
      initial={ENTRY_HIDDEN}
      whileInView={ENTRY_SHOWN}
      viewport={ENTRY_VIEWPORT}
      transition={{ duration: ENTRY_SECONDS, ease: ENTRY_EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
