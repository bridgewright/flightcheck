"use client";

import { useEffect } from "react";
import { useAnimate } from "motion/react";

import { PANEL } from "@/lib/ui";
import type { WalkthroughStep } from "./walkthrough-steps";
import { CHIP_FROM_X, CURSOR_FROM, stepSequence } from "./walkthrough-motion";

// The walkthrough's stage (F-55): an abstract mock of where the reader is
// about to click, drawn entirely from tokens and inline SVG. No LinkedIn
// pixels: real screenshots are a trade dress problem and the fastest rotting
// asset in documentation, so the mock is neutral blocks with only the load
// bearing click target labeled in text.
//
// The stage is aria-hidden decoration. The caption below it, rendered by the
// popover, carries the complete instruction; a reader who never perceives
// this loses nothing.
//
// Every element is laid out in its END state, and the sequences animate the
// way there (offsets and fades with explicit from values). That is what
// makes reduced motion cheap and exact: render the same markup with no
// initial offsets and no effect, and the final frame is simply there.
//
// The parent keys this component by (step, runId), so entering a step plays
// its sequence once and Replay remounts it to play again. The PANEL ground
// is deliberate: the token for a sample or an aside, which is the annotation
// cue that keeps readers from trying to click the fake UI.

/** The mock's fixed inner canvas, so coordinates are deterministic on every
 * viewport and every replay. */
const CANVAS = "relative h-[6.5rem] w-[15rem]";

const BAR = "rounded-full bg-hairline";

/** The one real element in each mock: a labeled target in plain text. */
const TARGET_LABEL = "font-mono text-label text-ink";

/** The deterministic ink fill cursor, resting where the press lands. The
 * hop is played by the sequence as a translate from `from`; under reduced
 * motion it renders already arrived. */
function Cursor({ from, reduce }: { from: { x: number; y: number }; reduce: boolean }) {
  return (
    <svg
      data-anim="cursor"
      className="absolute left-1/2 top-1/2 z-10 origin-top-left"
      style={reduce ? undefined : { transform: `translate(${from.x}px, ${from.y}px)` }}
      width="14"
      height="14"
      viewBox="0 0 14 14"
    >
      <path
        d="M2 1 L2 12 L5.2 9.4 L7 13 L8.8 12.1 L7 8.6 L11 8.4 Z"
        className="fill-ink stroke-paper"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The click's echo: a circle that scales out and fades at the press point.
 * It never appears under reduced motion, and its end state is invisible, so
 * it starts and ends at opacity 0 either way. */
function Ripple() {
  return (
    <span
      data-anim="ripple"
      className="absolute left-1/2 top-1/2 -ml-2 -mt-2 size-4 rounded-full border border-ink opacity-0"
    />
  );
}

/** The instant state change, drawn as an overlay so the flip is one beat of
 * opacity: pressed pill, highlighted row, ink border. Visible from the start
 * under reduced motion, because that is the end state. */
function Flip({ className, reduce }: { className: string; reduce: boolean }) {
  return (
    <span
      data-anim="flip"
      className={`pointer-events-none absolute ${className} ${reduce ? "" : "opacity-0"}`}
    />
  );
}

function StepOne({ reduce }: { reduce: boolean }) {
  return (
    <div className={CANVAS}>
      <div className="absolute inset-0 rounded-control border border-hairline bg-surface p-2.5">
        <div className="flex items-center gap-2">
          <span className={`size-[18px] ${BAR}`} />
          <span className="flex flex-col gap-1.5">
            <span className={`h-1.5 w-20 ${BAR}`} />
            <span className={`h-1.5 w-14 ${BAR}`} />
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className={`h-4 w-8 ${BAR}`} />
          <span className={`h-4 w-8 ${BAR}`} />
          <div
            className={`relative inline-flex h-5 items-center rounded-control border border-field bg-surface px-1.5 ${TARGET_LABEL}`}
          >
            More
            <Flip className="inset-0 rounded-control border border-ink bg-ink/6" reduce={reduce} />
            <Ripple />
            <Cursor from={CURSOR_FROM[1]} reduce={reduce} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StepTwo({ reduce }: { reduce: boolean }) {
  const hidden = reduce ? undefined : { opacity: 0 };
  return (
    <div className={CANVAS}>
      <div className="absolute inset-x-0 top-0 rounded-control border border-hairline bg-surface p-2.5">
        <div className="flex items-center gap-2">
          <span className={`size-[18px] ${BAR}`} />
          <span className={`h-1.5 w-20 ${BAR}`} />
          <div
            className={`relative ml-auto inline-flex h-5 items-center rounded-control border border-ink bg-ink/6 px-1.5 ${TARGET_LABEL}`}
          >
            More
            <div
              data-anim="menu"
              className="absolute right-0 top-full z-10 mt-1 w-28 rounded-control border border-hairline bg-surface p-1"
              style={hidden}
            >
              <div data-anim="menu-row-1" className="flex h-4 items-center px-1.5" style={hidden}>
                <span className={`h-1.5 w-full ${BAR}`} />
              </div>
              <div
                data-anim="menu-row-2"
                className={`relative flex h-5 items-center rounded-control px-1.5 ${TARGET_LABEL}`}
                style={hidden}
              >
                Save to PDF
                <Flip className="inset-0 rounded-control bg-ink/6" reduce={reduce} />
                <Ripple />
                <Cursor from={CURSOR_FROM[2]} reduce={reduce} />
              </div>
              <div data-anim="menu-row-3" className="flex h-4 items-center px-1.5" style={hidden}>
                <span className={`h-1.5 w-10 ${BAR}`} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepThree({ reduce }: { reduce: boolean }) {
  return (
    <div className={`${CANVAS} flex items-center justify-center`}>
      <div className="relative flex h-8 w-32 items-center gap-2 rounded-control border border-field bg-surface px-2">
        <Flip className="-inset-px rounded-control border border-ink" reduce={reduce} />
        <div
          data-anim="chip"
          className="relative flex h-6 w-6 items-center justify-center rounded-[2px] border border-field bg-surface"
          style={reduce ? undefined : { transform: `translateX(${CHIP_FROM_X}px)` }}
        >
          <span className="absolute right-0 top-0 size-2 bg-paper-sunk [clip-path:polygon(0_0,100%_100%,0_100%)]" />
          <span className={TARGET_LABEL}>PDF</span>
        </div>
        <span
          data-anim="received"
          className={`h-1.5 w-10 ${BAR} ${reduce ? "" : "opacity-0"}`}
        />
      </div>
    </div>
  );
}

export default function WalkthroughStage({
  step,
  reduce,
}: {
  step: WalkthroughStep;
  reduce: boolean;
}) {
  const [scope, animate] = useAnimate();

  useEffect(() => {
    // Not a shorter animation: no animation. The markup without offsets IS
    // the end state, so there is nothing left to do.
    if (reduce) return;
    const controls = animate(stepSequence(step));
    return () => controls.stop();
    // Keyed by (step, runId) in the parent: this runs once per mount.
  }, [animate, step, reduce]);

  return (
    <div
      ref={scope}
      aria-hidden="true"
      className={`${PANEL} relative mt-3 flex h-[8.5rem] items-center justify-center overflow-hidden`}
    >
      <div data-anim="canvas" style={reduce ? undefined : { opacity: 0 }}>
        {step === 1 ? <StepOne reduce={reduce} /> : null}
        {step === 2 ? <StepTwo reduce={reduce} /> : null}
        {step === 3 ? <StepThree reduce={reduce} /> : null}
      </div>
    </div>
  );
}
