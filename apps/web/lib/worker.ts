// Server-side client for the scoring worker (services/scorer FastAPI app).
// The "server-only" import makes any client-component import a build error:
// this module carries WORKER_API_TOKEN and must never reach the browser.
import "server-only";

import { headers as inboundHeaders } from "next/headers";
import { cache } from "react";

import {
  REQUEST_ID_HEADER,
  isNextControlFlowError,
  newRequestId,
  normalizeRequestId,
} from "@/lib/request-id";
import type {
  CreatePackageBody,
  CreateSessionResponse,
  OrderRow,
  PackageRow,
  PackageStatus,
  SessionRow,
  SessionStatus,
  TranscriptSegment,
  UsageMetrics,
  Verdict,
} from "@/lib/types";

/**
 * The id for the request being served, minted once and reused by every
 * worker call it makes (F-36).
 *
 * React's cache() is what makes "once" true: it memoizes per request, so a
 * page that fans out to four worker calls correlates as one unit of work in
 * the worker's logs. An id already on the inbound request wins, so a proxy
 * or an upstream service that stamps one keeps its trace intact.
 *
 * Outside a Next request scope — a script, this repo's tests — headers()
 * throws and a fresh id is minted per call. The call stays traceable; it
 * just is not correlated with anything, which is the honest answer. Next's
 * own control-flow throws are re-raised untouched: swallowing the
 * static-rendering bailout would leave a page prerendered with one
 * request's data baked in, which is far worse than a missing log id.
 */
const requestId = cache(async (): Promise<string> => {
  try {
    const inbound = normalizeRequestId((await inboundHeaders()).get(REQUEST_ID_HEADER));
    if (inbound !== null) {
      return inbound;
    }
  } catch (error) {
    if (isNextControlFlowError(error)) {
      throw error;
    }
    // No request scope to read. Fall through to a fresh id.
  }
  return newRequestId();
});

export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.WORKER_URL;
  const token = process.env.WORKER_API_TOKEN;
  if (!base) {
    throw new Error("WORKER_URL is not set");
  }
  if (!token) {
    throw new Error("WORKER_API_TOKEN is not set");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has(REQUEST_ID_HEADER)) {
    headers.set(REQUEST_ID_HEADER, await requestId());
  }
  return fetch(`${base.replace(/\/+$/, "")}${path}`, { ...init, headers, cache: "no-store" });
}

/**
 * Typed failure for any non-2xx worker reply (v0.5).
 *
 * `status` is the HTTP status; `code` is the worker's machine-readable error
 * code (the `code` key of its JSON error body — e.g. "package-exhausted",
 * "package-expired", "mint-cap"), or "unknown" for endpoints that predate
 * codes; `detail` is the human-readable `error`/`detail` string when the body
 * carried one. The message keeps the pre-v0.5 shape
 * ("worker {label} failed: {status}") — logs and tests pin it. Callers that
 * want honest UI states (exhausted vs expired vs outage) switch on
 * status/code instead of parsing the message.
 */
export class WorkerError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;

  constructor(label: string, status: number, code: string, detail: string | null) {
    super(`worker ${label} failed: ${status}`);
    this.name = "WorkerError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function workerError(label: string, response: Response): Promise<WorkerError> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    code?: unknown;
    detail?: unknown;
  };
  const code = typeof body.code === "string" ? body.code : "unknown";
  const detail =
    typeof body.error === "string"
      ? body.error
      : typeof body.detail === "string"
        ? body.detail
        : null;
  return new WorkerError(label, response.status, code, detail);
}

async function workerJson<T>(label: string, response: Response): Promise<T> {
  if (!response.ok) {
    throw await workerError(label, response);
  }
  return (await response.json()) as T;
}

// A worker 422 rejects the INPUT with a user-actionable message (e.g.
// "could not fetch that URL; paste the JD text instead" for an unfetchable
// jd_url) — distinct from a worker outage. Callers surface the message to
// the user instead of a generic 502. The worker's newer error bodies use the
// "error" key; FastAPI's own validation uses "detail" (sometimes a list) —
// accept a string from either, else fall back to a generic message.
export class WorkerRejectionError extends Error {}

export async function createPackage(
  body: CreatePackageBody,
): Promise<{ package_id: string; access_token: string }> {
  const response = await workerFetch("/api/packages", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (response.status === 422) {
    const rejection = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      detail?: unknown;
    };
    const message =
      typeof rejection.error === "string"
        ? rejection.error
        : typeof rejection.detail === "string"
          ? rejection.detail
          : "the worker rejected the request";
    throw new WorkerRejectionError(message);
  }
  return workerJson("POST /api/packages", response);
}

export async function getPackageByToken(token: string): Promise<PackageRow> {
  const path = `/api/packages/by-token/${encodeURIComponent(token)}`;
  return workerJson(`GET ${path}`, await workerFetch(path));
}

export async function createSession(packageId: string): Promise<CreateSessionResponse> {
  const response = await workerFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ package_id: packageId }),
  });
  return workerJson("POST /api/sessions", response);
}

// Outcome of POST /api/sessions/{id}/complete. The worker guards the paid
// scoring trigger: 202 enqueues a run ("accepted"); 409 means the session is
// already "scoring" or "scored" and nothing new was started
// ("already-scored") — for callers that is an already-in-progress success
// (the report exists or is on its way), not a failure.
export type CompleteSessionResult = "accepted" | "already-scored";

export async function completeSession(
  id: string,
  audioPath: string,
): Promise<CompleteSessionResult> {
  const path = `/api/sessions/${encodeURIComponent(id)}/complete`;
  const response = await workerFetch(path, {
    method: "POST",
    body: JSON.stringify({ audio_path: audioPath }),
  });
  if (response.status === 409) {
    return "already-scored";
  }
  if (!response.ok) {
    throw await workerError(`POST ${path}`, response);
  }
  return "accepted";
}

export async function getSession(id: string): Promise<SessionRow> {
  const path = `/api/sessions/${encodeURIComponent(id)}`;
  return workerJson(`GET ${path}`, await workerFetch(path));
}

// --- Multi-session listings ---------------------------------------------
//
// The dashboards read a package's progress and a user's packages over HTTP
// like everything else: the browser never touches the database, and these
// summaries are deliberately narrower than the full rows (no session plan, no
// rubric, no interviewer instructions) because a list view has no use for
// them and they are expensive to ship.

export interface SessionSummary {
  id: string;
  index: number;
  status: SessionStatus;
  report_available: boolean;
  overall: number | null;
  // Null until the report exists — the archive shows verdicts inline without
  // an N+1 of full-session GETs.
  verdict: Verdict | null;
  // Coarse worker progress while "scoring", else null (mirrors SessionRow).
  scoring_stage: string | null;
  // Older rows predate the column, so the list renders without a date rather
  // than inventing one.
  created_at?: string | null;
  stopped_reporting?: boolean;
}

export async function heartbeatSession(sessionId: string): Promise<void> {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/heartbeat`;
  await workerJson(`POST ${path}`, await workerFetch(path, { method: "POST" }));
}

export async function reclaimSession(
  sessionId: string,
  packageId: string,
  userId: string,
): Promise<void> {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/reclaim`;
  await workerJson(
    `POST ${path}`,
    await workerFetch(path, {
      method: "POST",
      body: JSON.stringify({ package_id: packageId, user_id: userId }),
    }),
  );
}

export interface PackageSummary {
  id: string;
  access_token: string;
  status: PackageStatus;
  user_id: string | null;
  total_sessions: number;
  sessions_used: number;
  role_title: string | null;
  // v0.5: exposed by the worker's summaries (Track C) so lists can render
  // trial/paid/expiry state honestly. Optional because a pre-v0.5 worker
  // omits them; treat absence like the defaults (not trial, unpaid).
  is_trial?: boolean;
  paid_at?: string | null;
  /** Comped access (DECISIONS 037): unlocked with no order behind it. */
  comped_at?: string | null;
  expires_at?: string | null;
}

export async function listSessions(packageId: string): Promise<SessionSummary[]> {
  const path = `/api/packages/${encodeURIComponent(packageId)}/sessions`;
  const body = await workerJson<{ sessions?: SessionSummary[] }>(
    `GET ${path}`,
    await workerFetch(path),
  );
  return body.sessions ?? [];
}

export async function listPackagesForUser(userId: string): Promise<PackageSummary[]> {
  const path = `/api/users/${encodeURIComponent(userId)}/packages`;
  const body = await workerJson<{ packages?: PackageSummary[] }>(
    `GET ${path}`,
    await workerFetch(path),
  );
  return body.packages ?? [];
}

// --- Payments (v0.5) -----------------------------------------------------
//
// Client half of the payments contract; Track C ships the worker endpoints.
// The web NEVER talks to Polar's API from these helpers — the webhook route
// verifies Polar's signature, then provisions through markPackagePaid over
// the same bearer-authenticated worker channel as everything else.

/**
 * The order details the webhook forwards to the worker's
 * POST /api/packages/{id}/paid. Field names mirror the orders table;
 * paid_at is the payment timestamp from the Polar event (the 30-day expiry
 * window starts there, not at webhook-processing time).
 */
export interface PaidOrderBody {
  user_id: string;
  polar_order_id: string;
  polar_checkout_id?: string | null;
  amount_minor?: number | null;
  currency?: string | null;
  status?: string | null;
  paid_at: string;
}

/**
 * Mark a package paid: the worker idempotently records the order and flips
 * the package to its paid state (6 sessions, expiry 30 days from paid_at).
 * Safe to call again for a replayed webhook — the worker dedupes on
 * polar_order_id and never moves an existing expiry window.
 */
export async function markPackagePaid(
  packageId: string,
  order: PaidOrderBody,
): Promise<void> {
  const path = `/api/packages/${encodeURIComponent(packageId)}/paid`;
  const response = await workerFetch(path, {
    method: "POST",
    body: JSON.stringify(order),
  });
  if (!response.ok) {
    throw await workerError(`POST ${path}`, response);
  }
}

/** A user's orders, newest first — the receipts list in OrderHistory. */
export async function listOrders(userId: string): Promise<OrderRow[]> {
  const path = `/api/orders?user_id=${encodeURIComponent(userId)}`;
  const body = await workerJson<{ orders?: OrderRow[] }>(
    `GET ${path}`,
    await workerFetch(path),
  );
  return body.orders ?? [];
}

/**
 * Ask the worker to retry a failed rubric compile. The worker refuses
 * non-retryable states with a WorkerError the retry UI surfaces honestly.
 */
export async function retryCompile(packageId: string): Promise<void> {
  const path = `/api/packages/${encodeURIComponent(packageId)}/compile-retry`;
  const response = await workerFetch(path, { method: "POST" });
  if (!response.ok) {
    throw await workerError(`POST ${path}`, response);
  }
}

/**
 * Delete one package and everything under it (F-53).
 *
 * The worker checks ownership itself and answers 404 for a package this user
 * does not own, so a caller cannot use this to probe which ids exist. A 503
 * means the recordings would not delete and NOTHING was removed, which is the
 * one failure the caller has to relay honestly rather than retrying silently.
 */
export async function deletePackage(
  packageId: string,
  userId: string,
): Promise<{ sessions_deleted: number; recordings_deleted: number }> {
  const path = `/api/packages/${encodeURIComponent(packageId)}/delete`;
  return workerJson(
    `POST ${path}`,
    await workerFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    }),
  );
}

/**
 * Count one realtime-secret mint against the session's cap and return the
 * new total. Above the cap the worker replies 429, which surfaces here as a
 * WorkerError (status 429 + the worker's code) for the realtime-secret
 * route to translate into honest copy.
 */
export async function incrementSecretMint(sessionId: string): Promise<number> {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/secret-mint`;
  const body = await workerJson<{ secret_mints: number }>(
    `POST ${path}`,
    await workerFetch(path, { method: "POST" }),
  );
  return body.secret_mints;
}

// --- v0.6 ----------------------------------------------------------------
//
// Client half of the endpoints Phase 0 wired and the v0.6 tracks implement.
// (Phase 0 wired three; the rubric preview's client went with F-45 —
// DECISIONS 030.) Both surface failure the same way everything else here
// does — the typed WorkerError, whose `code` is what callers switch on, so a
// caller can tell a refusal from an outage without parsing a message.

/**
 * Delete an account and every artifact of it (F-34).
 *
 * The id rides as a query parameter, not a body: DELETE bodies are handled
 * unevenly by proxies and clients, and the id is not the secret here — the
 * bearer token is. Resolves only when the worker reports the deletion done;
 * anything else throws, so the caller never signs a user out of an account
 * that still exists.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const path = `/api/account?user_id=${encodeURIComponent(userId)}`;
  const response = await workerFetch(path, { method: "DELETE" });
  if (!response.ok) {
    // The message pins the endpoint, not the query string, so logs of a
    // failing deletion do not accumulate user ids.
    throw await workerError("DELETE /api/account", response);
  }
}


/**
 * The operator's usage numbers (F-13): completion rate, p50 latencies, and
 * package burn-through, aggregated by the worker from existing columns.
 *
 * sample_size rides along because no honest reading of these numbers is
 * possible without it.
 */
export async function usageMetrics(): Promise<UsageMetrics> {
  const path = "/api/metrics/usage";
  return workerJson(`GET ${path}`, await workerFetch(path));
}

// --- Transcript ----------------------------------------------------------

/**
 * The verbatim transcript of a session, or null when none is stored.
 *
 * Null is the honest pre-batch state: sessions scored before transcripts were
 * persisted exist but have nothing to show ("transcript unavailable" in the
 * UI). An unknown session id is an error (the worker 404s), never null.
 * Deliberately a separate endpoint: transcripts run 25-60KB and must not ride
 * the hot session-row polls.
 */
export async function getSessionTranscript(
  sessionId: string,
): Promise<TranscriptSegment[] | null> {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/transcript`;
  const body = await workerJson<{
    session_id: string;
    segments?: TranscriptSegment[] | null;
  }>(`GET ${path}`, await workerFetch(path));
  return body.segments ?? null;
}

// --- Progress ------------------------------------------------------------
//
// GET /api/packages/{id}/progress is the spine of the progress screen and the
// session-detail deltas: one entry per session, ascending index, slimmed on
// purpose. Full rationale/evidence stays on the session detail; the trend
// feed carries only what trend math needs (lib/progress.ts consumes this).

export interface ProgressDimensionScore {
  dimension_key: string;
  score: number;
}

// Aggregated from the report's silence_events server-side; null when the
// session has no report (planned/scoring/failed/insufficient).
export interface SilenceStats {
  count: number;
  total_s: number;
  longest_s: number;
}

export interface SessionProgressEntry {
  session_id: string;
  index: number;
  created_at: string | null;
  status: SessionStatus;
  verdict: Verdict | null;
  overall: number | null;
  // Empty when the session has no report. Keys are comparable only within a
  // package — every session shares the package's rubric.
  dimension_scores: ProgressDimensionScore[];
  wpm_overall: number | null;
  filler_rate_per_min: number | null;
  silence: SilenceStats | null;
  // The report's gaps[] verbatim; [] when no report exists.
  gaps: string[];
}

export interface PackageProgress {
  package_id: string;
  // Ascending session index, every row regardless of status — the UI decides
  // how unscored attempts appear on the timeline.
  sessions: SessionProgressEntry[];
}

export async function getPackageProgress(packageId: string): Promise<PackageProgress> {
  const path = `/api/packages/${encodeURIComponent(packageId)}/progress`;
  return workerJson(`GET ${path}`, await workerFetch(path));
}

/**
 * The account a package belongs to, or null while it is still unclaimed.
 *
 * PackageRow declares user_id now, but rows serialized by an older worker may
 * omit the key at runtime — the accessor normalizes that to null in one place.
 */
export function packageOwnerId(pkg: PackageRow): string | null {
  return pkg.user_id ?? null;
}

/** How many sessions the package owes, defaulting to the one package size the
 * product sells. The runtime guard stays because rows serialized by an older
 * worker may omit the column even though PackageRow now declares it. */
export const DEFAULT_TOTAL_SESSIONS = 6;

export function packageTotalSessions(pkg: PackageRow): number {
  const total: unknown = pkg.total_sessions;
  return typeof total === "number" && Number.isInteger(total) && total > 0
    ? total
    : DEFAULT_TOTAL_SESSIONS;
}

// --- Token capability checks -------------------------------------------
//
// The package access token IS the v0.1 security model: the privileged web
// routes (secret mint, recording upload, session complete) must prove the
// caller holds the token for the package that owns the session BEFORE doing
// anything expensive or secret. Unknown tokens/sessions map to 403 without
// revealing which part failed; worker outages map to 502 so an unreachable
// worker is never misreported as an access denial.

export type Authorized<T> =
  | { ok: true; value: T }
  | { ok: false; status: 403 | 502 };

// The worker's GET /api/sessions/{id} returns the SessionRow fields plus
// interviewer_instructions (rebuilt deterministically server-side). The
// field exists only here, server-side — it must never be forwarded to the
// browser.
export type SessionWithInstructions = SessionRow & {
  interviewer_instructions?: string;
};

export async function authorizePackage(
  token: string,
): Promise<Authorized<PackageRow>> {
  const res = await workerFetch(
    `/api/packages/by-token/${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    return { ok: false, status: res.status === 404 ? 403 : 502 };
  }
  return { ok: true, value: (await res.json()) as PackageRow };
}

export async function authorizeSession(
  token: string,
  sessionId: string,
): Promise<Authorized<{ pkg: PackageRow; session: SessionWithInstructions }>> {
  const pkg = await authorizePackage(token);
  if (!pkg.ok) {
    return pkg;
  }
  const res = await workerFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) {
    return { ok: false, status: res.status === 404 ? 403 : 502 };
  }
  const session = (await res.json()) as SessionWithInstructions;
  if (session.package_id !== pkg.value.id) {
    return { ok: false, status: 403 };
  }
  return { ok: true, value: { pkg: pkg.value, session } };
}

/**
 * Account-based session authorization for the id-routed screens
 * (/sessions/[id] and friends): the viewer may see a session iff one of the
 * packages bound to their account owns it. The matching PackageSummary rides
 * along because every caller needs package context (role title, session
 * quota) anyway.
 *
 * Same denial discipline as the token checks: unknown session ids and
 * foreign-owned sessions both map to 403 without revealing which, and a
 * worker outage maps to 502 so it is never misreported as a denial. The
 * viewer parameter is structural ({ id }) so this module never depends on
 * the auth stack — lib/viewer.Viewer satisfies it.
 */
export async function authorizeViewerSession(
  viewer: { id: string },
  sessionId: string,
): Promise<Authorized<{ session: SessionWithInstructions; pkg: PackageSummary }>> {
  const res = await workerFetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    return { ok: false, status: res.status === 404 ? 403 : 502 };
  }
  const session = (await res.json()) as SessionWithInstructions;
  let packages: PackageSummary[];
  try {
    packages = await listPackagesForUser(viewer.id);
  } catch {
    return { ok: false, status: 502 };
  }
  const pkg = packages.find((candidate) => candidate.id === session.package_id);
  if (pkg === undefined) {
    return { ok: false, status: 403 };
  }
  return { ok: true, value: { session, pkg } };
}
