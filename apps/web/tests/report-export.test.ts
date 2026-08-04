import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, authorizeSession, authorizeViewerSession } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  authorizeSession: vi.fn(),
  authorizeViewerSession: vi.fn(),
}));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({ authorizeSession, authorizeViewerSession }));

const { GET, runtime } = await import("@/app/api/reports/[sessionId]/route");

const report = {
  session_id: "sess-1",
  verdict: "ready",
  headline: "Ready for the next interview.",
  eligibility: "scored",
  overall_score: 4.2,
  dimension_scores: [{
    dimension_key: "story",
    score: 4.2,
    rationale: "A complete rationale.",
    evidence_quotes: ["The customer renewed."],
    strengths: [],
    weaknesses: [],
  }],
  delivery_metrics: {
    wpm_overall: 130,
    wpm_timeline: [],
    silence_events: [],
    filler_count: 2,
    filler_rate_per_min: 0.5,
    f0_variance: null,
    avg_response_latency_s: null,
  },
  delivery_observations: [],
  strengths: ["Clear evidence"],
  gaps: [],
  next_drills: ["Repeat under time pressure"],
  limits_note: "One session is bounded evidence.",
};

function access(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    value: {
      session: {
        id: "sess-1",
        package_id: "pkg-1",
        index: 3,
        status: "scored",
        created_at: "2026-08-04T02:00:00Z",
        report,
        ...overrides,
      },
      pkg: {
        id: "pkg-1",
        role_title: "Staff Engineer",
        rubric: { dimensions: [{ key: "story", name: "Story structure" }] },
      },
    },
  };
}

function request(query = ""): Request {
  return new Request(`http://web.test/api/reports/sess-1${query}`);
}

beforeEach(() => {
  getViewer.mockReset();
  authorizeSession.mockReset();
  authorizeViewerSession.mockReset();
  getViewer.mockResolvedValue({ id: "user-1" });
  authorizeViewerSession.mockResolvedValue(access());
});

describe("GET /api/reports/[sessionId]", () => {
  it("uses the Node runtime and returns a PDF attachment", async () => {
    const response = await GET(request(), { params: Promise.resolve({ sessionId: "sess-1" }) });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="flightcheck-session-03-2026-08-04.pdf"',
    );
  });

  it("returns 404 when the report is not scored", async () => {
    authorizeViewerSession.mockResolvedValue(access({ report: { ...report, eligibility: "limited" } }));
    const response = await GET(request(), { params: Promise.resolve({ sessionId: "sess-1" }) });
    expect(response.status).toBe(404);
  });

  it("returns 403 for an unauthorized viewer", async () => {
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 403 });
    const response = await GET(request(), { params: Promise.resolve({ sessionId: "sess-1" }) });
    expect(response.status).toBe(403);
  });

  it("uses a live token for shared access", async () => {
    getViewer.mockResolvedValue(null);
    authorizeSession.mockResolvedValue(access());
    const response = await GET(request("?format=md&token=live-token"), {
      params: Promise.resolve({ sessionId: "sess-1" }),
    });
    expect(response.status).toBe(200);
    expect(authorizeSession).toHaveBeenCalledWith("live-token", "sess-1");
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });

  it("refuses a revoked shared token", async () => {
    getViewer.mockResolvedValue(null);
    authorizeSession.mockResolvedValue(access({ token_revoked_at: "2026-08-04T00:00:00Z" }));
    const response = await GET(request("?token=revoked-token"), {
      params: Promise.resolve({ sessionId: "sess-1" }),
    });
    expect(response.status).toBe(403);
  });
});

describe("the export's palette is white, and pinned", () => {
  it("carries exactly the five declared values and no product colour", () => {
    // The exemption in token-vocabulary.test.ts buys this file the right to
    // hold literal colour. This is the bound on it: a report is read on white,
    // so the paper ground must never arrive here, and a sixth value means
    // somebody started designing in a file no design gate can see.
    const source = readFileSync(
      fileURLToPath(new URL("../components/ReportPdf.tsx", import.meta.url)),
      "utf8",
    );
    const hexes = [...source.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]);
    expect(new Set(hexes)).toEqual(
      new Set(["#ffffff", "#171717", "#555555", "#333333", "#aaaaaa"]),
    );
    expect(source).toContain("backgroundColor: WHITE");
  });
});
