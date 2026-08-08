// Pure formatting behind the rubric screen (S5). JSX-free and free of any
// server-only import so vitest exercises it directly; RubricView stays thin.
import type { BarsAnchor, Channel, RubricDimension } from "@/lib/types";

/** Rubric weights are fractions (0.3); people read percentages ("30%"). */
export function formatWeight(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

// The dual-channel model is the product's core claim: content is scored from
// the transcript, delivery from the raw audio. The labels say so in plain
// words instead of leaking internal channel keys.
const CHANNEL_LABELS: Record<Channel, string> = {
  content: "Content: what you say",
  delivery: "Delivery: how you say it",
};

export function channelLabel(channel: Channel): string {
  return CHANNEL_LABELS[channel];
}

/** Top score first: the screen exists to show the bar, so what "excellent"
 * looks like leads and the failure modes follow. Non-mutating. */
export function sortedAnchors(anchors: BarsAnchor[]): BarsAnchor[] {
  return [...anchors].sort((a, b) => b.score - a.score);
}

// --- Receipts (F-62) ------------------------------------------------------
//
// A post-F-62 rubric carries, per content dimension, the verbatim JD quote
// that licenses it. Delivery dimensions never carry one: how the candidate
// sounds is part of every interview, so that bar is the product's own, and
// the screen says so in fine print. Every rubric stored before F-62 lacks
// the field on every dimension and must render exactly as it always has,
// which is why "does this rubric have receipts at all" is a decision about
// the whole rubric and lives here rather than in the component.

/** The slice of a dimension the receipt decision reads. */
type ReceiptCarrier = Pick<RubricDimension, "jd_evidence" | "license">;

/**
 * True only for a post-F-62 rubric: at least one dimension carries a
 * non-blank JD receipt or a profile-licensed dimension. The profile branch
 * has no JD quote by design: the candidate's own background licenses it.
 * The delivery line keys on this, never on channel alone, so a pre-F-62
 * rubric renders byte-identical to today.
 */
export function hasReceipts(dimensions: ReceiptCarrier[]): boolean {
  return dimensions.some(
    (dimension) =>
      dimension.license === "profile" ||
      (dimension.jd_evidence ?? "").trim() !== "",
  );
}

/**
 * The delivery dimension's one line, in place of a JD quote. One quoted
 * string literal on purpose: the built-copy gate exists because joined
 * copy can be folded apart by the production bundler.
 */
export const DELIVERY_RECEIPT =
  "This bar comes from the product, not your JD: how you sound is part of every interview.";

export const PROFILE_RECEIPT =
  "This bar comes from your own profile - the interview probes your motivation and fit for this specific company and role.";
