// Contract tests for the complete-webapp batch additions to lib/worker.ts:
// package creation born-bound (user_id passthrough), enriched session
// summaries, the transcript and progress endpoints, and the viewer-based
// session authorization that replaces token capability checks on the new
// id-based routes. Same fetch-stub harness as tests/worker.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authorizeViewerSession,
  createPackage,
  getPackageProgress,
  getSessionTranscript,
  listSessions,
} from "@/lib/worker";
import type { PackageProgress, SessionProgressEntry } from "@/lib/worker";
import type { TranscriptSegment } from "@/lib/types";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const calls: RecordedCall[] = [];
let nextResponse: Response;
// FIFO for helpers that make more than one worker call
// (authorizeViewerSession); when empty, the stub falls back to nextResponse.
let queuedResponses: Response[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

describe("createPackage user_id passthrough", () => {
  it("forwards user_id so packages are born bound", async () => {
    nextResponse = jsonResponse({ package_id: "pkg-1", access_token: "tok-1" }, 202);
    await createPackage({ jd_text: "We hire analysts.", user_id: "user-1" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      jd_text: "We hire analysts.",
      user_id: "user-1",
    });
  });

  it("omits user_id when the caller has none", async () => {
    nextResponse = jsonResponse({ package_id: "pkg-1", access_token: "tok-1" }, 202);
    await createPackage({ jd_text: "We hire analysts." });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      jd_text: "We hire analysts.",
    });
  });
});

describe("listSessions enriched summaries", () => {
  it("passes verdict and scoring_stage through to the summary", async () => {
    nextResponse = jsonResponse({
      sessions: [
        {
          id: "sess-1",
          index: 1,
          status: "scored",
          report_available: true,
          overall: 2.9,
          verdict: "approaching",
          scoring_stage: null,
          created_at: "2026-08-01T09:00:00Z",
        },
        {
          id: "sess-2",
          index: 2,
          status: "scoring",
          report_available: false,
          overall: null,
          verdict: null,
          scoring_stage: "transcribing",
          created_at: "2026-08-02T09:00:00Z",
        },
      ],
    });
    const sessions = await listSessions("pkg-1");
    expect(sessions[0].verdict).toBe("approaching");
    expect(sessions[0].scoring_stage).toBeNull();
    expect(sessions[1].verdict).toBeNull();
    expect(sessions[1].scoring_stage).toBe("transcribing");
  });
});

describe("getSessionTranscript", () => {
  const segments: TranscriptSegment[] = [
    { start_s: 0.0, end_s: 4.2, speaker: "interviewer", text: "Walk me through it." },
    { start_s: 4.6, end_s: 21.9, speaker: "candidate", text: "Uh, my recommendation was..." },
  ];

  it("gets the transcript endpoint with the id url-encoded", async () => {
    nextResponse = jsonResponse({ session_id: "sess/1", segments: [] });
    await getSessionTranscript("sess/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/sessions/sess%2F1/transcript",
    );
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("returns the segments the worker reports", async () => {
    nextResponse = jsonResponse({ session_id: "sess-1", segments });
    expect(await getSessionTranscript("sess-1")).toEqual(segments);
  });

  it("returns null when the transcript is unavailable (pre-batch session)", async () => {
    nextResponse = jsonResponse({ session_id: "sess-1", segments: null });
    expect(await getSessionTranscript("sess-1")).toBeNull();
  });

  it("throws with the status code when the session is unknown", async () => {
    nextResponse = jsonResponse({ detail: "session not found" }, 404);
    await expect(getSessionTranscript("sess-9")).rejects.toThrow(
      "worker GET /api/sessions/sess-9/transcript failed: 404",
    );
  });
});

describe("getPackageProgress", () => {
  const entry: SessionProgressEntry = {
    session_id: "sess-1",
    index: 1,
    created_at: "2026-08-01T09:00:00Z",
    status: "scored",
    verdict: "not_ready",
    overall: 2.4,
    dimension_scores: [
      { dimension_key: "structured-communication", score: 2.5 },
      { dimension_key: "delivery-composure", score: 2.0 },
    ],
    wpm_overall: 128.4,
    filler_rate_per_min: 1.6,
    silence: { count: 3, total_s: 7.4, longest_s: 3.1 },
    gaps: ["Composure under pressure (2.0/5): long silences after challenges."],
  };

  it("gets the progress endpoint with the id url-encoded", async () => {
    nextResponse = jsonResponse({ package_id: "pkg/1", sessions: [] });
    await getPackageProgress("pkg/1");
    expect(calls[0].url).toBe(
      "https://worker.example.test/api/packages/pkg%2F1/progress",
    );
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("returns the per-session entries the worker reports", async () => {
    nextResponse = jsonResponse({ package_id: "pkg-1", sessions: [entry] });
    const progress: PackageProgress = await getPackageProgress("pkg-1");
    expect(progress.package_id).toBe("pkg-1");
    expect(progress.sessions).toHaveLength(1);
    expect(progress.sessions[0].silence?.longest_s).toBe(3.1);
    expect(progress.sessions[0].dimension_scores[1].score).toBe(2.0);
  });

  it("throws with the status code on a non-2xx reply", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    await expect(getPackageProgress("pkg-1")).rejects.toThrow(
      "worker GET /api/packages/pkg-1/progress failed: 500",
    );
  });
});

describe("authorizeViewerSession", () => {
  const viewer = { id: "user-1" };
  const session = { id: "sess-1", package_id: "pkg-1", index: 1, status: "scored" };
  const ownedPackages = {
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
  };

  it("authorizes when the session's package belongs to the viewer", async () => {
    queuedResponses = [jsonResponse(session), jsonResponse(ownedPackages)];
    const result = await authorizeViewerSession(viewer, "sess-1");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions/sess-1");
    expect(calls[1].url).toBe("https://worker.example.test/api/users/user-1/packages");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.session.id).toBe("sess-1");
      expect(result.value.pkg.role_title).toBe("Forward Deployed PM");
    }
  });

  it("url-encodes the session id in the worker path", async () => {
    queuedResponses = [
      jsonResponse({ ...session, id: "sess/1" }),
      jsonResponse(ownedPackages),
    ];
    await authorizeViewerSession(viewer, "sess/1");
    expect(calls[0].url).toBe("https://worker.example.test/api/sessions/sess%2F1");
  });

  it("denies with 403 when the session does not exist", async () => {
    nextResponse = jsonResponse({ detail: "not found" }, 404);
    expect(await authorizeViewerSession(viewer, "sess-9")).toEqual({
      ok: false,
      status: 403,
    });
    // Never leaks whether the id exists by fetching further.
    expect(calls).toHaveLength(1);
  });

  it("denies with 403 when the viewer does not own the session's package", async () => {
    queuedResponses = [
      jsonResponse({ ...session, package_id: "pkg-foreign" }),
      jsonResponse(ownedPackages),
    ];
    expect(await authorizeViewerSession(viewer, "sess-1")).toEqual({
      ok: false,
      status: 403,
    });
  });

  it("maps a session-lookup worker failure to 502, not a denial", async () => {
    nextResponse = jsonResponse({ detail: "boom" }, 500);
    expect(await authorizeViewerSession(viewer, "sess-1")).toEqual({
      ok: false,
      status: 502,
    });
  });

  it("maps a package-list worker failure to 502, not a denial", async () => {
    queuedResponses = [jsonResponse(session), jsonResponse({ detail: "boom" }, 500)];
    expect(await authorizeViewerSession(viewer, "sess-1")).toEqual({
      ok: false,
      status: 502,
    });
  });
});
