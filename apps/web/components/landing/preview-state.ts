import type { Channel, RubricPreview, RubricPreviewDimension } from "@/lib/types";

import { PREVIEW_WIDGET } from "./copy";

// The judgment behind the landing rubric preview, kept out of the component
// so it can be tested without a DOM. The component below it is then only
// markup and a fetch.

/** What the visitor should do about a refusal, which decides what we render. */
export type RefusalAction = "edit" | "retry" | "sign-in";

export interface PreviewRefusalView {
  message: string;
  action: RefusalAction;
}

export type PreviewState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "ready"; preview: RubricPreview }
  | { kind: "refused"; refusal: PreviewRefusalView };

// Which action each refusal calls for. Waiting does not help a visitor who is
// over a window or a ceiling, so those point at the paid path, which has
// neither. Retrying does help a timeout or a one-off bad reply.
const ACTIONS: Record<string, RefusalAction> = {
  "preview-too-short": "edit",
  "preview-too-long": "edit",
  "preview-rate-limited": "sign-in",
  "preview-busy": "sign-in",
  "preview-ceiling": "sign-in",
  "preview-timeout": "retry",
  "preview-failed": "retry",
};

const FALLBACK_MESSAGE =
  "The preview did not come back this time. Try again, or sign in and compile " +
  "yours for real.";

/** A weight as a whole percent, clamped so no bar can render past its track. */
export function weightPercent(weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) {
    return 0;
  }
  return Math.min(100, Math.round(weight * 100));
}

/**
 * Heaviest first.
 *
 * The point of this screen is "here is what this role actually turns on", and
 * that lands in the first two rows or not at all. Array.prototype.sort is
 * stable in every runtime this ships to, so equal weights keep the compiler's
 * order and the same JD reads the same way twice.
 */
export function orderedDimensions(
  dimensions: RubricPreviewDimension[],
): RubricPreviewDimension[] {
  return [...dimensions].sort((a, b) => b.weight - a.weight);
}

/** The two channels, named the way the report names them. */
export function channelLabel(channel: Channel): string {
  return channel === "delivery"
    ? PREVIEW_WIDGET.deliveryChannel
    : PREVIEW_WIDGET.contentChannel;
}

/**
 * A 200 body, only if it really is a bar.
 *
 * The route between here and the worker is ours, but "the response was 200"
 * is not the same claim as "the response is a rubric" — a proxy, a redirect
 * to a login wall, or a future shape change all arrive as 200. Rendering an
 * empty or half-shaped bar would be the one dishonest outcome this widget can
 * produce, so an unrecognisable body is treated as a refusal instead.
 */
export function asPreview(body: unknown): RubricPreview | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { role_title: roleTitle, company, dimensions } = body as Record<string, unknown>;
  if (typeof roleTitle !== "string" || !Array.isArray(dimensions) || dimensions.length === 0) {
    return null;
  }
  const rows: RubricPreviewDimension[] = [];
  for (const row of dimensions) {
    if (typeof row !== "object" || row === null) {
      return null;
    }
    const { key, name, weight, channel } = row as Record<string, unknown>;
    if (
      typeof key !== "string" ||
      typeof name !== "string" ||
      typeof weight !== "number" ||
      (channel !== "content" && channel !== "delivery")
    ) {
      return null;
    }
    rows.push({ key, name, weight, channel });
  }
  return {
    role_title: roleTitle,
    company: typeof company === "string" && company.trim() ? company : null,
    dimensions: rows,
  };
}

/**
 * Turn a refusal body into a sentence and an action.
 *
 * The sentence is the server's, because that is where the copy is decided
 * (app/api/preview/refusals.ts) and there should be one voice. Anything that
 * is not a recognisable refusal body — a proxy's HTML error page, an empty
 * 502, a newer worker's unknown code — still produces an honest sentence and
 * a retry, never a blank panel and never raw upstream text.
 */
export function readRefusal(body: unknown): PreviewRefusalView {
  if (typeof body !== "object" || body === null) {
    return { message: FALLBACK_MESSAGE, action: "retry" };
  }
  const { error, code } = body as { error?: unknown; code?: unknown };
  // hasOwnProperty, not a bare index: `ACTIONS["constructor"]` resolves up the
  // prototype chain to a function, which would read as a KNOWN code and let
  // the body's own `error` string render as if it were our copy. An
  // unrecognised code has to fall through to the sentence we wrote.
  const known =
    typeof code === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, code)
      ? ACTIONS[code]
      : undefined;
  return {
    message: known !== undefined && typeof error === "string" ? error : FALLBACK_MESSAGE,
    action: known ?? "retry",
  };
}
