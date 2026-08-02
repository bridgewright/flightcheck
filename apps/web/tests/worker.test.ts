import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkerRejectionError,
  authorizePackage,
  authorizeSession,
  completeSession,
  createPackage,
  createSession,
  getPackageByToken,
  getSession,
  listPackagesForUser,
  listSessions,
  packageOwnerId,
  packageTotalSessions,
  workerFetch,
} from "@/lib/worker";
import type { PackageRow } from "@/lib/types";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const calls: RecordedCall[] = [];
let nextResponse: Response;
// FIFO for helpers that make more than one worker call (authorizeSession);
// when empty, the stub falls back to nextResponse.
let queuedResponses: Response[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sentHeaders(): Headers {
  return new Headers(calls[0].init?.headers);
}

beforeEach(() => {
  calls.length = 0;
  nextResponse = jsonResponse({});
  queuedResponses = [];
  vi.stubEnv("WORKER_URL", "https://worker.example.test");
  vi.stubEnv("WORKER_API_TOKEN", "test-worker-token");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return queuedResponses.shift() ?? nextResponse;
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("workerFetch", () => {
  it("joins WORKER_URL and the path", async () => {
    await workerFetch("/healthz");
    expect(calls[0].url).toBe("https://worker.example.test/healthz");
  });

  it("sends the bearer token from WORKER_API_TOKEN", async () => {
    await workerFetch("/healthz");
    expect(sentHeaders().get("authorization")).toBe("Bearer test-worker-token");
  });

  it("sets a json content-type when a body is present", async () => {
    await workerFetch("/api/packages", { method: "POST", body: JSON.stringify({ jd_text: "x" }) });
    expect(sentHeaders().get("content-type")).toBe("application/json");
  });

  it("throws before fetching when WORKER_URL is missing", async () => {
    vi.stubEnv("WORKER_URL", "");
    await expect(workerFetch("/healthz")).rejects.toThrow("WORKER_URL");
    expect(calls).toHaveLength(0);
  });

  it("throws before fetching when WORKER_API_TOKEN is missing", async () => {
    vi.stubEnv("WORKER_API_TOKEN", "");
    await expect(workerFetch("/healthz")).rejects.toThrow("WORKER_API_TOKEN");
    expect(calls).toHaveLength(0);
  });
});

describe("createPackage", () => {
  it("posts the intake body and returns package_id and access_token", async () => {
    nextResponse = jsonResponse({ package_id: "pkg-1", access_token: "tok-1" }, 202);
    const created = await createPackage({ jd_text: "We hire analysts." });
    expect(calls[0].url).toBe("https://worker.example.test/api/packages");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ jd_text: "We hire analysts." });
    expect(created).toEqual({ package_id: "pkg-1", access_token: "tok-1" });
  });

  it("throws with the status code on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    await expect(createPackage({ jd_text: "x" })).rejects.toThrow(
      "worker POST /api/packages failed: 500",
    );
  });

  it("maps the worker's 422 to a WorkerRejectionError with its message", async () => {
    // The worker's JD-fetch rejection uses the "error" key (not "detail").
    nextResponse = jsonResponse(
      { error: "could not fetch that URL; paste the JD text instead" },
      422,
    );
    const err = await createPackage({ jd_url: "https://jd.example.test/x" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WorkerRejectionError);
    expect((err as Error).message).toBe(
      "could not fetch that URL; paste the JD text instead",
    );
  });

  it("falls back to a generic message when the 422 detail is not a string", async () => {
    nextResponse = jsonResponse(
      { detail: [{ loc: ["body", "extra"], msg: "extra fields not permitted" }] },
      422,
    );
    const err = await createPackage({ jd_text: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerRejectionError);
    expect((err as Error).message).toBe("the worker rejected the request");
  });
});

describe("getPackageByToken", () => {
  it("gets the by-token path with the token url-encoded", async () => {
    nextResponse = jsonResponse({ id: "pkg-1", access_token: "tok/1", status: "compiling" });
    await getPackageByToken("tok/1");
    expect(calls[0].url).toBe("https://worker.example.test/api/packages/by-token/tok%2F1");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });
});

describe("createSession", () => {
  it("posts package_id and returns the session payload", async () => {
    nextResponse = jsonResponse({
      session_id: "sess-1",
      session_plan: null,
      interviewer_instructions: "You are Morgan.",
    });
    const created = await createSession("pkg-1");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ package_id: "pkg-1" });
    expect(created.session_id).toBe("sess-1");
  });
});

describe("completeSession", () => {
  it("posts audio_path to the complete endpoint and reports acceptance", async () => {
    nextResponse = jsonResponse({ session_id: "sess-1", status: "scoring" }, 202);
    const result = await completeSession("sess-1", "packages/pkg-1/session-1.webm");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions/sess-1/complete");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      audio_path: "packages/pkg-1/session-1.webm",
    });
    expect(result).toBe("accepted");
  });

  it("maps the worker's 409 re-score guard to already-scored, not an error", async () => {
    // The worker's 409 body uses the "error" key (not FastAPI's "detail").
    nextResponse = jsonResponse(
      { error: "session is already scored; it cannot be re-scored" },
      409,
    );
    expect(await completeSession("sess-1", "x.webm")).toBe("already-scored");
  });

  it("throws with the status code on other non-2xx replies", async () => {
    nextResponse = jsonResponse({ detail: "not found" }, 404);
    await expect(completeSession("sess-9", "x.webm")).rejects.toThrow(
      "worker POST /api/sessions/sess-9/complete failed: 404",
    );
  });
});

describe("getSession", () => {
  it("gets the session row by id", async () => {
    nextResponse = jsonResponse({ id: "sess-1", package_id: "pkg-1", status: "scoring" });
    const row = await getSession("sess-1");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions/sess-1");
    expect(row.status).toBe("scoring");
  });
});

describe("listSessions", () => {
  it("gets the package's session list with the id url-encoded", async () => {
    nextResponse = jsonResponse({ sessions: [] });
    await listSessions("pkg/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/packages/pkg%2F1/sessions",
    );
  });

  it("returns the session summaries the worker reports", async () => {
    nextResponse = jsonResponse({
      sessions: [
        { id: "sess-1", index: 1, status: "scored", report_available: true, overall: 2.9 },
        { id: "sess-2", index: 2, status: "scoring", report_available: false, overall: null },
      ],
    });
    const sessions = await listSessions("pkg-1");
    expect(sessions).toHaveLength(2);
    expect(sessions[0].overall).toBe(2.9);
    expect(sessions[1].status).toBe("scoring");
  });

  it("treats a missing sessions key as an empty list", async () => {
    nextResponse = jsonResponse({});
    expect(await listSessions("pkg-1")).toEqual([]);
  });

  it("throws with the status code on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    await expect(listSessions("pkg-1")).rejects.toThrow(
      "worker GET /api/packages/pkg-1/sessions failed: 500",
    );
  });
});

describe("listPackagesForUser", () => {
  it("gets the user's packages with the id url-encoded", async () => {
    nextResponse = jsonResponse({ packages: [] });
    await listPackagesForUser("user/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/users/user%2F1/packages",
    );
  });

  it("returns the package summaries the worker reports", async () => {
    nextResponse = jsonResponse({
      packages: [
        {
          id: "pkg-1",
          access_token: "tok-1",
          status: "ready",
          user_id: "user-1",
          total_sessions: 6,
          sessions_used: 3,
          role_title: "Forward Deployed PM",
        },
      ],
    });
    const packages = await listPackagesForUser("user-1");
    expect(packages).toHaveLength(1);
    expect(packages[0].role_title).toBe("Forward Deployed PM");
    expect(packages[0].sessions_used).toBe(3);
  });

  it("treats a missing packages key as an empty list", async () => {
    nextResponse = jsonResponse({});
    expect(await listPackagesForUser("user-1")).toEqual([]);
  });

  it("throws with the status code on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    await expect(listPackagesForUser("user-1")).rejects.toThrow(
      "worker GET /api/users/user-1/packages failed: 500",
    );
  });
});

describe("packageOwnerId", () => {
  it("reads the owner the worker reports", () => {
    const pkg = { id: "pkg-1", user_id: "user-1" } as unknown as PackageRow;
    expect(packageOwnerId(pkg)).toBe("user-1");
  });

  it("reports an unclaimed package as null", () => {
    const pkg = { id: "pkg-1", user_id: null } as unknown as PackageRow;
    expect(packageOwnerId(pkg)).toBeNull();
  });

  it("reports null when the worker predates the ownership column", () => {
    const pkg = { id: "pkg-1" } as unknown as PackageRow;
    expect(packageOwnerId(pkg)).toBeNull();
  });
});

describe("packageTotalSessions", () => {
  it("uses the size the worker reports", () => {
    expect(packageTotalSessions({ total_sessions: 3 } as unknown as PackageRow)).toBe(3);
  });

  it("falls back to the package size the product sells", () => {
    expect(packageTotalSessions({} as unknown as PackageRow)).toBe(6);
    expect(packageTotalSessions({ total_sessions: 0 } as unknown as PackageRow)).toBe(6);
  });
});

describe("authorizePackage", () => {
  it("returns the package when the token resolves", async () => {
    nextResponse = jsonResponse({ id: "pkg-1", access_token: "tok-1", status: "ready" });
    const result = await authorizePackage("tok-1");
    expect(calls[0].url).toBe("https://worker.example.test/api/packages/by-token/tok-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("pkg-1");
    }
  });

  it("url-encodes the token in the worker path", async () => {
    nextResponse = jsonResponse({ id: "pkg-1" });
    await authorizePackage("tok/1");
    expect(calls[0].url).toBe("https://worker.example.test/api/packages/by-token/tok%2F1");
  });

  it("maps an unknown token (404) to a 403 denial", async () => {
    nextResponse = jsonResponse({ detail: "not found" }, 404);
    expect(await authorizePackage("nope")).toEqual({ ok: false, status: 403 });
  });

  it("maps a worker failure (500) to 502, not a denial", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    expect(await authorizePackage("tok-1")).toEqual({ ok: false, status: 502 });
  });
});

describe("authorizeSession", () => {
  const pkg = { id: "pkg-1", access_token: "tok-1", status: "ready" };

  it("authorizes when the session belongs to the token's package", async () => {
    queuedResponses = [
      jsonResponse(pkg),
      jsonResponse({
        id: "sess-1",
        package_id: "pkg-1",
        index: 1,
        status: "planned",
        interviewer_instructions: "You are Morgan.",
      }),
    ];
    const result = await authorizeSession("tok-1", "sess-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pkg.id).toBe("pkg-1");
      expect(result.value.session.interviewer_instructions).toBe("You are Morgan.");
    }
  });

  it("url-encodes the session id in the worker path", async () => {
    queuedResponses = [
      jsonResponse(pkg),
      jsonResponse({ id: "sess/1", package_id: "pkg-1" }),
    ];
    await authorizeSession("tok-1", "sess/1");
    expect(calls[1].url).toBe("https://worker.example.test/api/sessions/sess%2F1");
  });

  it("denies without fetching the session when the token is unknown", async () => {
    nextResponse = jsonResponse({ detail: "not found" }, 404);
    expect(await authorizeSession("nope", "sess-1")).toEqual({ ok: false, status: 403 });
    expect(calls).toHaveLength(1);
  });

  it("denies when the session belongs to a different package", async () => {
    queuedResponses = [
      jsonResponse(pkg),
      jsonResponse({ id: "sess-1", package_id: "pkg-other" }),
    ];
    expect(await authorizeSession("tok-1", "sess-1")).toEqual({ ok: false, status: 403 });
  });

  it("denies when the session does not exist", async () => {
    queuedResponses = [jsonResponse(pkg), jsonResponse({ detail: "nope" }, 404)];
    expect(await authorizeSession("tok-1", "sess-9")).toEqual({ ok: false, status: 403 });
  });

  it("maps a session-lookup worker failure to 502", async () => {
    queuedResponses = [jsonResponse(pkg), jsonResponse({ detail: "boom" }, 500)];
    expect(await authorizeSession("tok-1", "sess-1")).toEqual({ ok: false, status: 502 });
  });
});
