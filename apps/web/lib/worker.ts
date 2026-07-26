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
