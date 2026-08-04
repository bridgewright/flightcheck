// The walkthrough's choreography as data (F-55): one animation sequence per
// step, played once on step entry by the stage component via useAnimate.
//
// Everything here is transform and opacity, on the two curves the reference
// ships, at the storyboard's absolute times. The grammar, from the spec:
// cursor hops decelerate (0.4 to 0.5s, ENTRY_EASE), appearances take 0.3s,
// siblings stagger 0.05s, presses scale to 0.9 with no overshoot, and state
// flips are instant while only appearances animate. That last split is what
// makes the mock feel responsive rather than syrupy.
//
// The elements are addressed by data-anim attributes so the stage markup and
// this module cannot drift apart silently: walkthrough-motion.test.ts checks
// the discipline on these objects, and the stage renders the attributes.

import type { AnimationSequence } from "motion/react";

import {
  ENTRY_EASE,
  ENTRY_SECONDS,
  ENTRY_STAGGER_SECONDS,
  FADE_EASE,
} from "@/components/motion/entry";
import type { WalkthroughStep } from "./walkthrough-steps";

/** The animated parts of the stage, as selectors. */
export const ANIM = {
  canvas: '[data-anim="canvas"]',
  cursor: '[data-anim="cursor"]',
  /** The instant state change: a pressed pill, a highlighted row, an ink
   * border. Drawn as an overlay whose opacity flips in one beat. */
  flip: '[data-anim="flip"]',
  ripple: '[data-anim="ripple"]',
  menu: '[data-anim="menu"]',
  menuRows: [
    '[data-anim="menu-row-1"]',
    '[data-anim="menu-row-2"]',
    '[data-anim="menu-row-3"]',
  ],
  chip: '[data-anim="chip"]',
  received: '[data-anim="received"]',
} as const;

/** A state flip is instant; this is one beat of opacity, not a fade. */
export const FLIP_SECONDS = 0.01;

/** Where the cursor travels FROM, as an offset in px from its resting place
 * on the click target. The stage positions the cursor at rest and the
 * sequence plays the hop, so reduced motion gets the end state by rendering
 * the markup with no offset at all. */
export const CURSOR_FROM: Record<1 | 2, { x: number; y: number }> = {
  /** Step 1: in from the bottom right of the canvas. */
  1: { x: 88, y: 56 },
  /** Step 2: down from the More pill the reader just pressed. */
  2: { x: 10, y: -30 },
};

/** Step 3's file chip slides in from outside the upload field. */
export const CHIP_FROM_X = -56;

const pressDown = { scale: 0.9 };
const pressUp = { scale: 1 };
const ripple = { scale: [0.4, 2.4], opacity: [0.5, 0] };

/** Each step's full sequence. Played once per (step, runId) mount; Replay
 * bumps runId. All times are absolute, straight from the storyboard tables. */
export function stepSequence(step: WalkthroughStep): AnimationSequence {
  const enter: AnimationSequence[number] = [
    ANIM.canvas,
    { opacity: [0, 1] },
    { duration: ENTRY_SECONDS, ease: FADE_EASE, at: 0 },
  ];

  if (step === 1) {
    // Find More: one decelerating hop to the pill, press, flip, ripple.
    return [
      enter,
      [
        ANIM.cursor,
        { x: [CURSOR_FROM[1].x, 0], y: [CURSOR_FROM[1].y, 0] },
        { duration: 0.5, ease: ENTRY_EASE, at: 0 },
      ],
      [ANIM.cursor, pressDown, { duration: 0.1, at: 0.5 }],
      [ANIM.flip, { opacity: 1 }, { duration: FLIP_SECONDS, at: 0.55 }],
      [ANIM.ripple, ripple, { duration: 0.4, ease: FADE_EASE, at: 0.55 }],
      [ANIM.cursor, pressUp, { duration: 0.15, at: 0.6 }],
    ];
  }

  if (step === 2) {
    // Save to PDF: the menu drops with its rows staggered, then the cursor
    // hops down from More and presses the labeled row.
    const drop = { opacity: [0, 1], y: [-4, 0] };
    return [
      enter,
      [ANIM.menu, drop, { duration: ENTRY_SECONDS, ease: ENTRY_EASE, at: 0 }],
      ...ANIM.menuRows.map((row, index): AnimationSequence[number] => [
        row,
        { opacity: [0, 1] },
        { duration: ENTRY_SECONDS, ease: ENTRY_EASE, at: index * ENTRY_STAGGER_SECONDS },
      ]),
      [
        ANIM.cursor,
        { x: [CURSOR_FROM[2].x, 0], y: [CURSOR_FROM[2].y, 0] },
        { duration: 0.4, ease: ENTRY_EASE, at: 0.35 },
      ],
      [ANIM.cursor, pressDown, { duration: 0.1, at: 0.8 }],
      [ANIM.flip, { opacity: 1 }, { duration: FLIP_SECONDS, at: 0.85 }],
      [ANIM.ripple, ripple, { duration: 0.4, ease: FADE_EASE, at: 0.85 }],
      [ANIM.cursor, pressUp, { duration: 0.15, at: 0.9 }],
    ];
  }

  // Upload it here: the chip slides into the field, the border flips to ink,
  // and a received bar fades in beside it. No cursor: this step is our UI
  // receiving a file, not a click to imitate.
  return [
    enter,
    [ANIM.chip, { x: [CHIP_FROM_X, 0] }, { duration: 0.5, ease: ENTRY_EASE, at: 0 }],
    [ANIM.flip, { opacity: 1 }, { duration: FLIP_SECONDS, at: 0.5 }],
    [ANIM.received, { opacity: [0, 1] }, { duration: ENTRY_SECONDS, ease: FADE_EASE, at: 0.5 }],
  ];
}
