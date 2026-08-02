// Server-side client for the scoring worker (services/scorer FastAPI app).
// The "server-only" import makes any client-component import a build error:
// this module carries WORKER_API_TOKEN and must never reach the browser.
import "server-only";

import type {
  CreatePackageBody,
  CreateSessionResponse,
  PackageRow,
  PackageStatus,
  SessionRow,
  SessionStatus,
  TranscriptSegment,
  Verdict,
} from "@/lib/types";

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
  return fetch(`${base.replace(/\/+$/, "")}${path}`, { ...init, headers, cache: "no-store" });
}

async function workerJson<T>(label: string, response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`worker ${label} failed: ${response.status}`);
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
    throw new Error(`worker POST ${path} failed: ${response.status}`);
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
}

export interface PackageSummary {
  id: string;
  access_token: string;
  status: PackageStatus;
  user_id: string | null;
  total_sessions: number;
  sessions_used: number;
  role_title: string | null;
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
