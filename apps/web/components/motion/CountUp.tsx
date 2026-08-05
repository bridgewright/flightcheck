"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { ENTRY_EASE, ENTRY_SECONDS, REVEAL_ATTRIBUTE } from "./entry";

// The report's number, counted up once.
//
// Its one sentence, carried from the F-21 spec section that granted it: state
// transition, the number is the product's output and it deserves one moment.
// Once per mount and never again: the played ref is what "once" means, so a
// value that changes later snaps into place without a second performance, and
// a PollRefresh tick, which preserves this client instance, replays nothing.
//
// The server renders the final value, not zero. The count is for the reader
// who is there when the number arrives; a no-JS reader, a crawler, or a page
// whose bundle never loads is simply told the score. Width cannot wobble
// while it runs: every frame renders toFixed(decimals), so the digit count is
// constant, and callers set tabular-nums so equal digit counts are equal
// widths.
//
// Same prop rules as Reveal: presentational values only, nothing else, ever.

export default function CountUp({
  value,
  decimals,
  className,
}: {
  value: number;
  decimals: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const played = useRef(false);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce || played.current) {
      setShown(value);
      return;
    }
    played.current = true;
    const controls = animate(0, value, {
      duration: ENTRY_SECONDS,
      ease: ENTRY_EASE,
      onUpdate: (latest) => setShown(latest),
    });
    return () => controls.stop();
  }, [reduce, value]);

  // Not a faster count: the settled number, immediately.
  if (reduce) {
    return <span className={className}>{value.toFixed(decimals)}</span>;
  }

  return (
    <span {...REVEAL_ATTRIBUTE} className={className}>
      {shown.toFixed(decimals)}
    </span>
  );
}
