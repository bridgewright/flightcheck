// Whether an open menu should close, decided away from the DOM (F-57).
//
// One rule, two listeners: LightDismiss.tsx feeds it every document
// pointerdown and keydown while its panel is open, and this module answers
// close or stay, and whether closing hands focus back to the trigger. Pure on
// purpose: the repo has no DOM render harness, so the behaviour lives where
// vitest can hold it and the component keeps only plumbing.

export type LightDismissSignal =
  | {
      kind: "pointerdown";
      /** Whether the event target sits inside the details element, summary
       * and panel both. The summary must count as inside: closing on the own
       * trigger's pointerdown would let the native click that follows toggle
       * the menu straight back open. */
      targetInsideDetails: boolean;
    }
  | { kind: "keydown"; key: string };

export interface DismissDecision {
  /** Escape hands focus back to the summary, because the keyboard user's
   * focus may be deep in the panel that just vanished. An outside pointerdown
   * never does: the pointer is on its way to another target. */
  refocusSummary: boolean;
}

/** Close (with the focus consequence) or null to leave the menu open. */
export function dismissDecision(signal: LightDismissSignal): DismissDecision | null {
  if (signal.kind === "pointerdown") {
    return signal.targetInsideDetails ? null : { refocusSummary: false };
  }
  return signal.key === "Escape" ? { refocusSummary: true } : null;
}
