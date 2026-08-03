// Honest failure states for starting a session (F-30, web half).
//
// The worker refuses a session with a typed status + machine code (Phase 0
// WorkerError); the web route forwards {error, code} on the worker's status
// and StartSessionButton renders THIS mapping instead of the raw string the
// audit flagged ("exhausted-package 409 surfaces as generic red 502").
// Pure on purpose: the copy for every refusal is pinned by tests, and the
// client component stays a thin fetch-and-render shell.

export type StartFailureKind =
  | "in-progress"
  | "exhausted"
  | "expired"
  | "insufficient-terminal"
  | "rate-limited"
  | "unreachable"
  | "denied"
  | "unknown";

export interface StartFailureView {
  kind: StartFailureKind;
  title: string;
  message: string;
  /** Whether trying again can plausibly change the outcome. */
  retryable: boolean;
}

/**
 * Map a failed start-session response to its honest view. `status` is the
 * HTTP status (0 for a network-level failure before any response); `code`
 * is the worker's machine-readable refusal code when the route forwarded
 * one. The code wins over the status so the worker can refine its statuses
 * without this copy going stale.
 */
export function startFailureView(
  status: number,
  code?: string | null,
): StartFailureView {
  // The worker's live spelling is "session-terminal" (a retired slot after
  // the resume/re-score caps); "insufficient-terminal" is kept as an alias.
  if (code === "insufficient-terminal" || code === "session-terminal") {
    return {
      kind: "insufficient-terminal",
      title: "This session cannot be restarted",
      message:
        "Too many attempts at this session ended before they could be " +
        "scored, so it is now closed. If the failures were technical " +
        "rather than yours, contact support.",
      retryable: false,
    };
  }
  if (code === "package-expired" || status === 410) {
    return {
      kind: "expired",
      title: "This package has expired",
      message:
        "The 30-day session window has ended, so new sessions cannot " +
        "start. Your reports and recordings remain available.",
      retryable: false,
    };
  }
  // Must precede the exhausted branch: F-38's lock also answers 409, and
  // falling through told a customer with five sessions left that they had none.
  if (code === "session-in-progress") {
    return {
      kind: "in-progress",
      title: "A session is already in progress",
      message:
        "Finish the session you have open, or wait for it to time out (up " +
        "to 25 minutes) before starting another. This does not use up a " +
        "session from your package.",
      retryable: true,
    };
  }
  if (code === "package-exhausted" || status === 409) {
    return {
      kind: "exhausted",
      title: "No sessions left in this package",
      message:
        "All interview sessions in this package have been used. Your " +
        "reports and recordings remain available.",
      retryable: false,
    };
  }
  if (code === "rate-limited" || status === 429) {
    return {
      kind: "rate-limited",
      title: "Too many attempts in a short time",
      message: "Wait a minute, then try again.",
      retryable: true,
    };
  }
  if (status === 0 || status === 502 || status === 503 || status === 504) {
    return {
      kind: "unreachable",
      title: "The scoring service is unreachable",
      message:
        "Nothing was used from your package. Try again in a minute.",
      retryable: true,
    };
  }
  if (status === 401) {
    return {
      kind: "denied",
      title: "Sign-in required",
      message: "Your sign-in has ended. Sign in again, then start the session.",
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      kind: "denied",
      title: "Access denied",
      message: "This package does not belong to the signed-in account.",
      retryable: false,
    };
  }
  return {
    kind: "unknown",
    title: "The session could not be started",
    message: `The request failed (status ${status}). Try again in a minute.`,
    retryable: true,
  };
}
