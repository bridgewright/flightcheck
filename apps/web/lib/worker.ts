// Server-side client for the scoring worker (services/scorer FastAPI app).
// The "server-only" import makes any client-component import a build error:
// this module carries WORKER_API_TOKEN and must never reach the browser.
import "server-only";

import type {
  CreatePackageBody,
  CreateSessionResponse,
  PackageRow,
  SessionRow,
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

export async function createPackage(
  body: CreatePackageBody,
): Promise<{ package_id: string; access_token: string }> {
  const response = await workerFetch("/api/packages", {
    method: "POST",
    body: JSON.stringify(body),
  });
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

export async function completeSession(id: string, audioPath: string): Promise<void> {
  const path = `/api/sessions/${encodeURIComponent(id)}/complete`;
  const response = await workerFetch(path, {
    method: "POST",
    body: JSON.stringify({ audio_path: audioPath }),
  });
  if (!response.ok) {
    throw new Error(`worker POST ${path} failed: ${response.status}`);
  }
}

export async function getSession(id: string): Promise<SessionRow> {
  const path = `/api/sessions/${encodeURIComponent(id)}`;
  return workerJson(`GET ${path}`, await workerFetch(path));
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
