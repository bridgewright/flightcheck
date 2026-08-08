import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, authorizeViewerSession, getSessionCoaching, getSessionTranscript } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  authorizeViewerSession: vi.fn(),
  getSessionCoaching: vi.fn(),
  getSessionTranscript: vi.fn(),
}));
vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({ authorizeViewerSession, getSessionCoaching, getSessionTranscript }));

const { GET, runtime, dynamic } = await import("@/app/api/session-study/[sessionId]/route");
const params = { params: Promise.resolve({ sessionId: "sess-1" }) };
const request = (query = "") => new Request(`http://web.test/api/session-study/sess-1${query}`);
const access = {
  ok: true,
  value: {
    session: { id: "sess-1", index: 2, status: "scored", created_at: "2026-08-07T15:00:00Z", report: { eligibility: "scored" } },
    pkg: { id: "pkg-1", role_title: "FDPM" },
  },
};
const question = "How did you measure the result?";
const coaching = {
  session_id: "sess-1",
  paraphrases: { schema_version: 1, generated_at: "2026-08-08", turn_count: 1, items: [{ turn_index: 0, verdict: "improve", source_quote: "volume fell", suggestion: "Support volume fell by eighteen percent.", why: "Names the result." }] },
  insights: null,
  marks: { schema_version: 1, marks: { "0": { reaction: null, bookmarked: true, flag: null } } },
};
const segments = [
  { start_s: 0, end_s: 1, speaker: "interviewer", text: question },
  { start_s: 1, end_s: 3, speaker: "candidate", text: "Support volume fell after the launch." },
];

beforeEach(() => {
  getViewer.mockReset().mockResolvedValue({ id: "viewer-1", email: null });
  authorizeViewerSession.mockReset().mockResolvedValue(access);
  getSessionCoaching.mockReset().mockResolvedValue(coaching);
  getSessionTranscript.mockReset().mockResolvedValue(segments);
});

describe("session study export route", () => {
  it("uses Node and is never cached", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns 403 to an anonymous viewer", async () => {
    getViewer.mockResolvedValue(null);
    expect((await GET(request("?format=md"), params)).status).toBe(403);
    expect(authorizeViewerSession).not.toHaveBeenCalled();
  });

  it("returns a generic 403 to a non-owner without leaking the session id", async () => {
    authorizeViewerSession.mockResolvedValue({ ok: false, status: 403 });
    const response = await GET(request("?format=md"), params);
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(JSON.parse(body)).toEqual({ error: "access denied" });
    expect(body).not.toContain("sess-1");
  });

  it("returns the fixed unavailable 404 to an owner without coaching and leaks no session id", async () => {
    getSessionCoaching.mockResolvedValue({ ...coaching, paraphrases: null, insights: null });
    const response = await GET(request("?format=md"), params);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: "study unavailable" });
    expect(body).not.toContain("sess-1");
  });

  it("returns markdown with the exact filename and question", async () => {
    const response = await GET(request("?format=md"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="flightcheck-session-02-study-2026-08-07.md"');
    expect(await response.text()).toContain(question);
  });

  it("returns a real PDF and falls back to PDF for unknown formats", async () => {
    for (const query of ["?format=pdf", "?format=doc"]) {
      const response = await GET(request(query), params);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="flightcheck-session-02-study-2026-08-07.pdf"');
      expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    }
  });
});

describe("the printable palette", () => {
  it("matches ReportPdf exactly", () => {
    const read = (name: string) => readFileSync(fileURLToPath(new URL(`../components/${name}`, import.meta.url)), "utf8");
    const hexes = (source: string) => new Set([...source.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((match) => match[1]));
    expect(hexes(read("StudyPdf.tsx"))).toEqual(hexes(read("ReportPdf.tsx")));
  });
});
