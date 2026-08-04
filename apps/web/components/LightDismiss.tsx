"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { dismissDecision } from "@/components/light-dismiss";

// A details element that dismisses like a real menu (F-57).
//
// It renders the details/summary structure itself so consumers stay server
// components: the top bar's package switcher and account menu, and the /new
// help popover, each pass their trigger, panel, and class strings and keep
// their own rendering. While the panel is open, a pointerdown outside the
// element closes it, and Escape closes it and returns focus to the summary;
// the decision itself is components/light-dismiss.ts. The summary's native
// click-to-toggle is untouched, so with JavaScript disabled this is exactly
// today's menu.
//
// Two of these on one page need no coordination for pointer input: opening
// one begins with a pointerdown outside the other, which closes it before the
// click lands. Keyboard activation of a summary fires no pointerdown, so two
// menus opened by keyboard alone can coexist until Escape or a pointer
// arrives; that matches today's baseline and is left as it is.
//
// The details element stays uncontrolled. Native toggles mutate the DOM
// first, onToggle folds them into state, and dismissal writes the DOM
// property directly; the state exists only to gate the listeners and to keep
// aria-expanded honest.

export default function LightDismiss({
  summary,
  summaryClassName,
  summaryLabel,
  panelClassName,
  className,
  children,
}: {
  /** Trigger content, rendered inside the summary element. */
  summary: ReactNode;
  /** Classes for the summary, e.g. the top bar's SUMMARY string. */
  summaryClassName?: string;
  /** aria-label for triggers whose content does not name them. */
  summaryLabel?: string;
  /** Classes for the panel wrapper, e.g. MENU_PANEL plus an anchor side. */
  panelClassName?: string;
  /** Classes for the details element itself, e.g. "relative order-2". */
  className?: string;
  /** Panel content. */
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const close = (refocusSummary: boolean) => {
      const details = detailsRef.current;
      if (!details) return;
      details.open = false;
      if (refocusSummary) summaryRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details) return;
      const decision = dismissDecision({
        kind: "pointerdown",
        targetInsideDetails:
          event.target instanceof Node && details.contains(event.target),
      });
      if (decision) close(decision.refocusSummary);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const decision = dismissDecision({ kind: "keydown", key: event.key });
      if (decision) close(decision.refocusSummary);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <details
      ref={detailsRef}
      className={className}
      data-light-dismiss=""
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        ref={summaryRef}
        className={summaryClassName}
        aria-label={summaryLabel}
        aria-expanded={open}
      >
        {summary}
      </summary>
      <div className={panelClassName}>{children}</div>
    </details>
  );
}
