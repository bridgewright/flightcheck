"use client";

import { Children } from "react";
import { motion, useReducedMotion } from "motion/react";

import {
  ENTRY_EASE,
  ENTRY_HIDDEN,
  ENTRY_SECONDS,
  ENTRY_SHOWN,
  ENTRY_STAGGER_SECONDS,
  ENTRY_VIEWPORT,
  REVEAL_ATTRIBUTE,
} from "./entry";

// A row or grid whose cells arrive in order rather than together.
//
// The stagger is the whole point, so the arithmetic lives here instead of at
// four call sites: index * ENTRY_STAGGER_SECONDS, once, and never again.
//
// It renders the container itself so that each child becomes a grid or flex
// item of it. That works where the container is a div. Where the markup has to
// stay an ordered list, the call site keeps its own ol/li and wraps each item's
// contents in a Reveal with the same delay arithmetic, because a wrapper
// element between ol and li would trade the list's semantics for an animation.
//
// Props are children and a class string, and that is deliberate: see the note
// in Reveal.tsx about what a component in this directory is not allowed to be
// handed.

export default function RevealGroup({
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
    <div className={className}>
      {Children.map(children, (child, index) => (
        <motion.div
          {...REVEAL_ATTRIBUTE}
          initial={ENTRY_HIDDEN}
          whileInView={ENTRY_SHOWN}
          viewport={ENTRY_VIEWPORT}
          transition={{
            duration: ENTRY_SECONDS,
            ease: ENTRY_EASE,
            delay: index * ENTRY_STAGGER_SECONDS,
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  );
}
