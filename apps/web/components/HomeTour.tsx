"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MENU_PANEL, MUTED, PRIMARY_BUTTON, SECONDARY_BUTTON, STEP_NUMERAL } from "@/lib/ui";
import {
  decideBack,
  decideKey,
  decideNext,
  decideSkip,
  type TourOutcome,
} from "./tour/decide";
import { tourGeometry, type Box } from "./tour/geometry";
import {
  counterText,
  initialState,
  liveText,
  visibleSteps,
  type TourState,
  type TourStep,
} from "./tour/steps";
import { markTourDone, shouldShowTour } from "./tour/storage";

interface OpenTour {
  readonly steps: readonly TourStep[];
  readonly state: TourState;
}

interface Placement {
  readonly panes: readonly Box[];
  readonly card: { readonly top: number; readonly left: number };
}

/** Where the card sits for the frame between opening and the first measure. */
const FALLBACK_CARD = { top: 12, left: 12 };

export default function HomeTour() {
  const [tour, setTour] = useState<OpenTour | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldShowTour()) return;
    const frame = requestAnimationFrame(() => {
      const anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-tour]"))
        .map((element) => element.dataset.tour)
        .filter((anchor): anchor is string => Boolean(anchor));
      const steps = visibleSteps(anchors);
      // No anchors is not an arrival. Nothing is shown and nothing is written,
      // so the flag is still absent for a home that has something to point at.
      if (steps.length === 0) return;
      setTour({ steps, state: initialState() });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * The single place the tour changes, and the only place the once-flag is
   * written. Every button and every key routes through a decision in
   * `tour/decide.ts`, so which interactions end the tour is a tested property
   * rather than a rule repeated at four call sites.
   */
  const apply = useCallback((outcome: TourOutcome) => {
    if (outcome.markDone) markTourDone();
    if (outcome.state === null) {
      setTour(null);
      setPlacement(null);
      requestAnimationFrame(() => document.body.focus());
      return;
    }
    const next = outcome.state;
    setTour((current) => (current ? { ...current, state: next } : current));
  }, []);

  useEffect(() => {
    if (!tour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const outcome = decideKey(event.key, tour.state, tour.steps);
      if (!outcome.handled) return;
      event.preventDefault();
      apply(outcome);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [apply, tour]);

  useEffect(() => {
    if (!tour) return;
    const target = document.querySelector<HTMLElement>(
      `[data-tour="${tour.steps[tour.state.index].anchor}"]`,
    );
    if (!target) return;

    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    const update = () => {
      const rect = target.getBoundingClientRect();
      const card = cardRef.current?.getBoundingClientRect();
      setPlacement(
        tourGeometry(
          rect,
          { width: window.innerWidth, height: window.innerHeight },
          { width: card?.width ?? 280, height: card?.height ?? 180 },
        ),
      );
    };
    const frame = requestAnimationFrame(() => {
      update();
      cardRef.current?.focus();
    });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [tour]);

  if (!tour) return null;
  const step = tour.steps[tour.state.index];
  const isLast = tour.state.index === tour.steps.length - 1;
  // MENU_PANEL is written for a panel hanging off its trigger, so it carries
  // `absolute top-full mt-1.5 w-60 p-1`. Tailwind resolves a conflict by the
  // order it emits the utilities, not the order they sit in the attribute:
  // `fixed`, `z-50`, `w-[min(...)]` and `p-4` all win, but the margin reset
  // lost to `mt-1.5` and left the card painting 6px below the position the
  // geometry computed. The box therefore comes from the inline style, which
  // beats every class whatever order they are emitted in.
  const cardStyle = { ...(placement?.card ?? FALLBACK_CARD), margin: 0 };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {placement?.panes.map((pane, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="pointer-events-auto fixed bg-ink opacity-60"
          style={pane}
        />
      ))}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Home tour"
        tabIndex={-1}
        className={`${MENU_PANEL} pointer-events-auto fixed z-50 w-[min(18rem,calc(100vw-1.5rem))] p-4 outline-none`}
        style={cardStyle}
      >
        <div className="flex items-center gap-2">
          {/* The numeral and the counter say the same thing to a reader who can
              see them, and the live region says it once to a reader who cannot.
              Both marks are hidden so the position is not announced twice. */}
          <span aria-hidden="true" className={STEP_NUMERAL}>
            {tour.state.index + 1}
          </span>
          <span aria-hidden="true" className="font-mono text-label text-ink-faint">
            {counterText(tour.state, tour.steps)}
          </span>
          <span aria-live="polite" className="sr-only">
            {liveText(tour.state, tour.steps)}
          </span>
          <button
            type="button"
            className="ml-auto text-fine text-ink-muted underline"
            onClick={() => apply(decideSkip(tour.state))}
          >
            Skip
          </button>
        </div>
        <p className={`${MUTED} mt-3`}>{step.copy}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={tour.state.index === 0}
            onClick={() => apply(decideBack(tour.state))}
          >
            Back
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            onClick={() => apply(decideNext(tour.state, tour.steps))}
          >
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
