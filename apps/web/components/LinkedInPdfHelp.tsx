"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import LightDismiss from "@/components/LightDismiss";
import WalkthroughStage from "@/components/linkedin-help/WalkthroughStage";
import {
  BUTTON_LABELS,
  CAPTIONS,
  FINE_PRINTS,
  TRIGGER_LABEL,
  WALKTHROUGH_TITLE,
  advance,
  atEnd,
  back,
  canBack,
  counterText,
  initialState,
  liveText,
  primaryLabel,
  replay,
  reset,
} from "@/components/linkedin-help/walkthrough-steps";
import { ENTRY_SECONDS, FADE_EASE, REVEAL_ATTRIBUTE } from "@/components/motion/entry";
import { FINE_PRINT, SECONDARY_BUTTON, SUB_HEADING } from "@/lib/ui";

// The "?" beside the LinkedIn PDF upload on /new (F-55): a speech bubble
// popover holding a three step walkthrough of where that PDF comes from.
// Interaction spec: plans/dispatch/f55-walkthrough-spec.md.
//
// Pull, not push: only the trigger opens it, nothing ever auto opens it, and
// the page underneath stays fully interactive. It is a non-modal dialog with
// no focus trap, deliberately diverging from the reference libraries: the
// form is never blocked. Light dismiss (outside pointerdown, Escape with
// focus return) is LightDismiss's job; tab switches and window blur never
// close it, because the reader is expected to spend a minute in the LinkedIn
// tab and must find the bubble on the same step when they come back.
//
// Done is the one extra route out: it closes the bubble and moves focus to
// the real file input, whose standard focus ring lands the pointing.
// Reopening always restarts at step 1.

/** Mirrors the private PRESS gesture in lib/ui.ts. Exporting it there is a
 * one line change outside this track's owned files; hoist at merge. */
const PRESS =
  "transition-[background-color,color,border-color,opacity] duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)]";

/** STEP_NUMERAL's chip geometry with the field-to-ink control gesture. A
 * rounded rectangle, not a circle: only label chips are fully round. */
const TRIGGER =
  "inline-flex size-5 shrink-0 cursor-pointer list-none items-center justify-center rounded-control border border-field font-mono text-label text-ink-muted [&::-webkit-details-marker]:hidden hover:border-ink hover:text-ink " +
  PRESS;

/** The bubble. Below sm it spans the label row's full width and skips the
 * beak; from sm up it anchors to the trigger at the 10px offset with a
 * Shepherd style rotated square beak carrying the bubble's own surface. */
const BUBBLE =
  "absolute left-0 right-0 top-[calc(100%+10px)] z-20 rounded-surface border border-hairline bg-surface p-4 text-fine shadow-float sm:right-auto sm:w-96 sm:max-w-[calc(100vw-3rem)]";

const QUIET_CONTROL = `cursor-pointer font-mono uppercase hover:text-ink ${PRESS}`;

export default function LinkedInPdfHelp({ inputId }: { inputId: string }) {
  const [state, setState] = useState(initialState);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);

  // The details element is uncontrolled and owned by LightDismiss; open
  // state is read off its own toggle event, which fires for every route in
  // or out (trigger, Escape, outside pointerdown, the buttons below).
  useEffect(() => {
    const details = dialogRef.current?.closest("details");
    if (!details) return;
    const onToggle = () => {
      setOpen(details.open);
      if (details.open) setState((current) => reset(current));
    };
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, []);

  const onPrimary = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!atEnd(state)) {
      setState((current) => advance(current));
      return;
    }
    // Done: the last step's action terminates into the real one.
    const details = event.currentTarget.closest("details");
    if (details) details.open = false;
    document.getElementById(inputId)?.focus();
  };

  const onClose = (event: React.MouseEvent<HTMLButtonElement>) => {
    const details = event.currentTarget.closest("details");
    if (!details) return;
    details.open = false;
    const summary = details.querySelector("summary");
    if (summary instanceof HTMLElement) summary.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Scoped by placement: this listener lives on the dialog, so it only
    // sees keys while focus is inside it, and the popover contains no
    // text inputs for the arrows to collide with.
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setState((current) => advance(current));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setState((current) => back(current));
    }
  };

  const captionBlock = (
    <>
      <span className="sr-only">{liveText(state)}</span>
      <p id="linkedin-pdf-help-caption" className="text-fine text-ink">
        {CAPTIONS[state.step]}
      </p>
      <p className={`${FINE_PRINT} mt-1`}>{FINE_PRINTS[state.step]}</p>
    </>
  );

  return (
    <LightDismiss
      className="flex sm:relative"
      summary="?"
      summaryLabel={TRIGGER_LABEL}
      summaryClassName={TRIGGER}
      panelClassName={BUBBLE}
    >
      <span
        aria-hidden="true"
        className="absolute -top-[5px] left-[5px] hidden size-[10px] rotate-45 border-l border-t border-hairline bg-surface sm:block"
      />
      <div
        ref={dialogRef}
        id="linkedin-pdf-help"
        role="dialog"
        aria-labelledby="linkedin-pdf-help-title"
        aria-describedby="linkedin-pdf-help-caption"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="linkedin-pdf-help-title" className={SUB_HEADING}>
            {WALKTHROUGH_TITLE}
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`-m-1 flex size-6 shrink-0 cursor-pointer items-center justify-center text-ink-faint hover:text-ink ${PRESS}`}
          >
            ×
          </button>
        </div>
        {open ? (
          <WalkthroughStage
            key={`${state.step}-${state.runId}`}
            step={state.step}
            reduce={reduce === true}
          />
        ) : null}
        {reduce ? null : (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              aria-label="Replay the animation"
              onClick={() => setState((current) => replay(current))}
              className={`${QUIET_CONTROL} text-label text-ink-faint`}
            >
              {BUTTON_LABELS.replay}
            </button>
          </div>
        )}
        <div aria-live="polite" aria-atomic="true" className="mt-2 min-h-[5.25rem]">
          {reduce ? (
            <div>{captionBlock}</div>
          ) : (
            <motion.div
              key={state.step}
              {...REVEAL_ATTRIBUTE}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: ENTRY_SECONDS, ease: FADE_EASE }}
            >
              {captionBlock}
            </motion.div>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span aria-hidden="true" className="font-mono text-label text-ink-faint tabular-nums">
            {counterText(state)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-disabled={!canBack(state)}
              onClick={() => {
                if (canBack(state)) setState((current) => back(current));
              }}
              className={`${QUIET_CONTROL} text-action text-ink-muted ${
                canBack(state) ? "" : "pointer-events-none opacity-50"
              }`}
            >
              {BUTTON_LABELS.back}
            </button>
            {/* Deliberately not PRIMARY_BUTTON: the dark control is rationed
              to this page's one real ask, the submit at the bottom. */}
            <button type="button" onClick={onPrimary} className={SECONDARY_BUTTON}>
              {primaryLabel(state)}
            </button>
          </div>
        </div>
      </div>
    </LightDismiss>
  );
}
