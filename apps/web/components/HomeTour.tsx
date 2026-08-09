"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MENU_PANEL, MUTED, PRIMARY_BUTTON, SECONDARY_BUTTON, STEP_NUMERAL } from "@/lib/ui";
import { tourGeometry, type Box } from "./tour/geometry";
import {
  advance,
  back,
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
      if (steps.length === 0) return;
      setTour({ steps, state: initialState() });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const finishTour = useCallback(() => {
    markTourDone();
    setTour(null);
    setPlacement(null);
    requestAnimationFrame(() => document.body.focus());
  }, []);

  useEffect(() => {
    if (!tour) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finishTour();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = advance(tour.state, tour.steps);
        if (next.finished) finishTour();
        else setTour({ ...tour, state: next });
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setTour({ ...tour, state: back(tour.state) });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finishTour, tour]);

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
        className={`${MENU_PANEL} pointer-events-auto fixed top-0 z-50 m-0 w-[min(18rem,calc(100vw-1.5rem))] p-4 outline-none`}
        style={placement?.card ?? { top: 12, left: 12 }}
      >
        <div className="flex items-center gap-2">
          <span className={STEP_NUMERAL}>{tour.state.index + 1}</span>
          <span aria-hidden="true" className="font-mono text-label text-ink-faint">
            {counterText(tour.state, tour.steps)}
          </span>
          <span aria-live="polite" className="sr-only">
            {liveText(tour.state, tour.steps)}
          </span>
          <button type="button" className="ml-auto text-fine text-ink-muted underline" onClick={finishTour}>
            Skip
          </button>
        </div>
        <p className={`${MUTED} mt-3`}>{step.copy}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={tour.state.index === 0}
            onClick={() => setTour({ ...tour, state: back(tour.state) })}
          >
            Back
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            onClick={() => {
              const next = advance(tour.state, tour.steps);
              if (next.finished) finishTour();
              else setTour({ ...tour, state: next });
            }}
          >
            {isLast ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
