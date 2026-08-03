// Every way the rubric preview can decline, in the words a stranger reads.
//
// The degraded state is part of F-45, not an afterthought bolted on at the
// end: someone who pasted a job description and got nothing back is one
// sentence away from leaving, so each of these has to be true, specific about
// what happened, and explicit about the way through. "Sign in and compile
// yours for real" is that way through — the paid path has no ceiling, no
// shared queue, and no length cap this tight.
//
// Copy register: no apology theatre, no exclamation marks, no blame. The
// visitor did nothing wrong in any of these cases.

export const PREVIEW_REFUSAL_CODES = [
  "preview-too-short",
  "preview-too-long",
  "preview-rate-limited",
  "preview-busy",
  "preview-ceiling",
  "preview-timeout",
  "preview-failed",
] as const;

export type PreviewRefusalCode = (typeof PREVIEW_REFUSAL_CODES)[number];

export interface PreviewRefusal {
  status: number;
  code: PreviewRefusalCode;
  error: string;
}

// The worker writes its own copy for the states it detects, but this app is
// what the browser talks to, so the sentence a visitor sees is decided here —
// one voice, and no dependency on a downstream service's wording staying put.
const REFUSALS: Record<PreviewRefusalCode, PreviewRefusal> = {
  "preview-too-short": {
    status: 422,
    code: "preview-too-short",
    error:
      "That is too short to read a bar off. Paste the whole job description — " +
      "responsibilities and requirements included.",
  },
  "preview-too-long": {
    status: 422,
    code: "preview-too-long",
    error:
      "That is longer than the preview reads. Paste the role and requirements " +
      "sections, or sign in and compile the whole thing for real.",
  },
  "preview-rate-limited": {
    status: 429,
    code: "preview-rate-limited",
    error:
      "That is a few previews in a short while. Give it a few minutes, or sign " +
      "in and compile yours for real.",
  },
  "preview-busy": {
    status: 429,
    code: "preview-busy",
    error: "The preview is busy right now. Sign in and compile yours for real.",
  },
  "preview-ceiling": {
    status: 429,
    code: "preview-ceiling",
    error: "The preview is busy right now. Sign in and compile yours for real.",
  },
  "preview-timeout": {
    status: 504,
    code: "preview-timeout",
    error:
      "The preview took too long to come back. Try again, or sign in and " +
      "compile yours for real.",
  },
  "preview-failed": {
    status: 502,
    code: "preview-failed",
    error:
      "The preview did not come back this time. Try again, or sign in and " +
      "compile yours for real.",
  },
};

function isRefusalCode(code: string): code is PreviewRefusalCode {
  return (PREVIEW_REFUSAL_CODES as readonly string[]).includes(code);
}

/**
 * The refusal for a known code, or the calm catch-all.
 *
 * An unrecognised code means the worker refused for a reason this build does
 * not know about — a newer worker, or a proxy answering in its place. That is
 * still an honest "did not come back this time"; it is never a 200 with an
 * empty bar, and never a raw upstream message.
 */
export function refusalFor(code: string): PreviewRefusal {
  return isRefusalCode(code) ? REFUSALS[code] : REFUSALS["preview-failed"];
}

/**
 * The refusal for a code the WORKER sent back.
 *
 * One code is translated on the way through, and it matters. The worker's
 * `preview-rate-limited` cannot be a statement about this visitor: the
 * worker's client is this app, so every browser on earth arrives from the
 * same handful of egress addresses and that window is a SERVICE-level bound.
 * The per-visitor window is ./guard.ts, and it has already passed by the time
 * we call out. Rendering "that is a few previews in a short while" to someone
 * on their first paste would be a sentence about somebody else — this file's
 * whole premise is that the visitor did nothing wrong. Service saturation is
 * "busy", which is both true and the same thing we say when the slots or the
 * day's ceiling are the reason.
 */
export function refusalForWorker(code: string): PreviewRefusal {
  return refusalFor(code === "preview-rate-limited" ? "preview-busy" : code);
}
