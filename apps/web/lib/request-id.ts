// One id per unit of work, shared with the scoring worker.
//
// The web mints an id for each inbound request and forwards it on every
// worker call that request makes; the worker echoes it and binds it to its
// log records (services/scorer/src/scorer/api/requestid.py). A Railway
// traceback can then be tied to the Vercel request that caused it without
// guessing from timestamps.
//
// Pure and dependency-free on purpose: both the client wiring in lib/worker.ts
// and anything Track C adds on top validate through the same two functions.

export const REQUEST_ID_HEADER = "x-request-id";

// Must stay in step with _SAFE_REQUEST_ID in the worker's requestid.py. The
// bound and the charset are the point: a value that reaches a response
// header must not be able to carry CRLF, must survive a latin-1 header
// write, and must not push an unbounded string into every log line.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** An id we are willing to reuse, or null when the value is not safe. */
export function normalizeRequestId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const candidate = value.trim();
  return SAFE_REQUEST_ID.test(candidate) ? candidate : null;
}

/**
 * Whether an error is Next.js signalling control flow rather than failing.
 *
 * Next throws to redirect, to 404, and — the one that matters here — to bail
 * a route out of static rendering when it touches a request-time API. Those
 * throws all carry a string `digest`. Anything that reads request headers
 * inside a try/catch has to re-throw them: swallowing the static-rendering
 * bailout would leave a page prerendered with one request's data baked in.
 */
export function isNextControlFlowError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string"
  );
}
