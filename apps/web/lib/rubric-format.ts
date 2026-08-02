// Pure formatting behind the rubric screen (S5). JSX-free and free of any
// server-only import so vitest exercises it directly; RubricView stays thin.
import type { BarsAnchor, Channel } from "@/lib/types";

/** Rubric weights are fractions (0.3); people read percentages ("30%"). */
export function formatWeight(weight: number): string {
  return `${Math.round(weight * 100)}%`;
}

// The dual-channel model is the product's core claim: content is scored from
// the transcript, delivery from the raw audio. The labels say so in plain
// words instead of leaking internal channel keys.
const CHANNEL_LABELS: Record<Channel, string> = {
  content: "Content — what you say",
  delivery: "Delivery — how you say it",
};

export function channelLabel(channel: Channel): string {
  return CHANNEL_LABELS[channel];
}

/** Top score first: the screen exists to show the bar, so what "excellent"
 * looks like leads and the failure modes follow. Non-mutating. */
export function sortedAnchors(anchors: BarsAnchor[]): BarsAnchor[] {
  return [...anchors].sort((a, b) => b.score - a.score);
}
