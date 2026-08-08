// The study export route, exercised as the endpoint it is.
//
// A study guide quotes the customer verbatim and reasons about where they are
// weak. It is the most personal artifact this product holds, and unlike a
// session report it has no share link at all — there is no capability-token
// branch here on purpose, so the only way in is a signed-in owner. That makes
// the auth-negative cases the point of this file rather than a formality.
//
// The PDF is rendered for real rather than mocked: the thing that breaks in a
// react-pdf document is the render, and a mock that returns bytes proves the
// route's plumbing while hiding the only failure that actually happens.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, getPackageStudy, getPackageBookmarks, listPackagesForUser, getPackageByToken } =
  vi.hoisted(() => ({
    getViewer: vi.fn(),
    getPackageStudy: vi.fn(),
    getPackageBookmarks: vi.fn(),
    listPackagesForUser: vi.fn(),
    getPackageByToken: vi.fn(),
  }));

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  getPackageStudy,
  getPackageBookmarks,
  listPackagesForUser,
  getPackageByToken,
}));

const { GET, runtime, dynamic } = await import("@/app/api/study/[packageId]/route");

const SAVED_QUOTE = "we shipped it in six weeks with two engineers";
const PRIORITY_EXPRESSION = "cutting handle time by 18%";

const doc = {
  schema_version: 1,
  source_session_ids: ["sess-1"],
  summary: {
    core_problems: [{
      title: "Answers stay abstract",
      description: "Examples arrive without the number behind them.",
      dimension_keys: ["structured-answers"],
    }],
    improvement_strategy: ["Name the metric first.", "Rehearse the close."],
    priority_expressions: [PRIORITY_EXPRESSION],
  },
  jd_core_answers: [{
    question: "Walk me through a project you led end to end.",
    dimension_key: "structured-answers",
    model_answer: "Open with the outcome, then the mechanism.",
    based_on_quotes: [SAVED_QUOTE],
  }],
};

const bookmarks = {
  package_id: "pkg-1",
  sessions: [{
    session_id: "sess-1",
    session_index: 2,
    items: [{
      turn_index: 4,
      verdict: "improve" as const,
      source_quote: SAVED_QUOTE,
      suggestion: "We shipped in six weeks with a team of two.",
      why: "The constraint is the impressive part; lead with it.",
    }],
  }],
};

const ownedPackage = {
  id: "pkg-1",
  access_token: "tok-1",
  status: "ready",
  user_id: "viewer-1",
  total_sessions: 6,
  sessions_used: 2,
  role_title: "Forward Deployed Product Manager",
};

const request = (query = ""): Request =>
  new Request(`http://web.test/api/study/pkg-1${query}`);

const params = { params: Promise.resolve({ packageId: "pkg-1" }) };

beforeEach(() => {
  for (const mock of [getViewer, getPackageStudy, getPackageBookmarks, listPackagesForUser, getPackageByToken]) {
    mock.mockReset();
  }
  getViewer.mockResolvedValue({ id: "viewer-1", email: null });
  listPackagesForUser.mockResolvedValue([ownedPackage]);
  getPackageStudy.mockResolvedValue({
    package_id: "pkg-1",
    status: "ready",
    stale: false,
    generated_at: "2026-08-08T12:00:00Z",
    doc,
  });
  getPackageBookmarks.mockResolvedValue(bookmarks);
  getPackageByToken.mockResolvedValue({ id: "pkg-1", rubric: { role_title: "FDPM" } });
});

describe("the route's posture", () => {
  it("renders on Node and is never cached", () => {
    // react-pdf needs Node; a cached study guide would serve one customer's
    // verbatim quotes to the next request for the same path.
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("who is allowed to download a study guide", () => {
  it("refuses an anonymous caller before asking the worker anything", async () => {
    getViewer.mockResolvedValue(null);

    const response = await GET(request("?format=md"), params);

    expect(response.status).toBe(401);
    expect(listPackagesForUser).not.toHaveBeenCalled();
    expect(getPackageStudy).not.toHaveBeenCalled();
  });

  it("refuses a package the caller does not own, and never fetches it", async () => {
    listPackagesForUser.mockResolvedValue([{ ...ownedPackage, id: "someone-elses" }]);

    const response = await GET(request("?format=md"), params);

    expect(response.status).toBe(404);
    expect(getPackageStudy).not.toHaveBeenCalled();
  });

  it("answers a non-owner exactly as it answers an unknown package", async () => {
    // Ownership must not be probeable: two different bodies here would turn
    // this route into an oracle for which package ids exist.
    listPackagesForUser.mockResolvedValue([]);
    const foreign = await GET(request("?format=md"), params);
    listPackagesForUser.mockResolvedValue([ownedPackage]);
    getPackageStudy.mockResolvedValue({
      package_id: "pkg-1", status: "none", stale: false, generated_at: null, doc: null,
    });
    const missing = await GET(request("?format=md"), params);

    expect(foreign.status).toBe(missing.status);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("stays calm when the ownership check itself is unreachable", async () => {
    listPackagesForUser.mockRejectedValue(new Error("fetch failed"));

    const response = await GET(request("?format=md"), params);

    expect(response.status).toBe(404);
    expect(getPackageStudy).not.toHaveBeenCalled();
  });
});

describe("what is downloadable", () => {
  it("404s while the guide is still being built", async () => {
    getPackageStudy.mockResolvedValue({
      package_id: "pkg-1", status: "generating", stale: false, generated_at: null, doc: null,
    });

    expect((await GET(request("?format=md"), params)).status).toBe(404);
  });

  it("404s for a failed build that still carries the previous document", async () => {
    // The page renders that older document, deliberately. The export does not:
    // a file on disk outlives the banner that said which build it came from.
    getPackageStudy.mockResolvedValue({
      package_id: "pkg-1", status: "failed", stale: false,
      generated_at: "2026-08-01T00:00:00Z", doc,
    });

    expect((await GET(request("?format=md"), params)).status).toBe(404);
  });

  it("exports a stale-but-ready guide, because stale content is still true", async () => {
    getPackageStudy.mockResolvedValue({
      package_id: "pkg-1", status: "ready", stale: true,
      generated_at: "2026-08-08T12:00:00Z", doc,
    });

    expect((await GET(request("?format=md"), params)).status).toBe(200);
  });
});

describe("the markdown export", () => {
  it("carries the customer's own words verbatim", async () => {
    const response = await GET(request("?format=md"), params);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(body).toContain(SAVED_QUOTE);
    expect(body).toContain(PRIORITY_EXPRESSION);
  });

  it("names the file by the date the guide was generated", async () => {
    const response = await GET(request("?format=md"), params);

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="flightcheck-study-2026-08-08.md"',
    );
  });

  it("labels the generated sections as generated", async () => {
    // A model answer read back a month later must not be mistaken for
    // something the customer wrote themselves.
    const body = await (await GET(request("?format=md"), params)).text();

    expect(body.toLowerCase()).toContain("generated");
  });

  it("still exports when the bookmarks join is unreachable", async () => {
    // Bookmarks are a separate endpoint; a worker hiccup there must not cost
    // the customer the whole download.
    getPackageBookmarks.mockRejectedValue(new Error("worker down"));

    const response = await GET(request("?format=md"), params);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(PRIORITY_EXPRESSION);
  });
});

describe("the PDF export", () => {
  it("returns a real PDF as an attachment", async () => {
    const response = await GET(request("?format=pdf"), params);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="flightcheck-study-2026-08-08.pdf"',
    );
  });

  it("is what an unrecognised format falls back to", async () => {
    const response = await GET(request("?format=doc"), params);

    expect(response.headers.get("content-type")).toBe("application/pdf");
  });

  it("renders with no bookmarks at all", async () => {
    // The section is optional; an undefined map over it is the classic way a
    // react-pdf document throws at render time rather than at type time.
    getPackageBookmarks.mockResolvedValue({ package_id: "pkg-1", sessions: [] });

    const response = await GET(request("?format=pdf"), params);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer()).length).toBeGreaterThan(0);
  });

  it("renders when the bookmarks join is unreachable", async () => {
    getPackageBookmarks.mockRejectedValue(new Error("worker down"));

    expect((await GET(request("?format=pdf"), params)).status).toBe(200);
  });
});

describe("the printable palette is white, and pinned", () => {
  it("carries exactly the five declared values and no product colour", () => {
    // The same bound report-export.test.ts puts on ReportPdf, and the reason
    // the token-vocabulary exemption for this file is defensible: a sixth
    // value means somebody started designing in a file no design gate sees.
    // `toContain` per colour would not catch that, which is the whole risk.
    const source = readFileSync(
      fileURLToPath(new URL("../components/StudyPdf.tsx", import.meta.url)),
      "utf8",
    );
    const hexes = [...source.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((match) => match[1]);

    expect(new Set(hexes)).toEqual(
      new Set(["#ffffff", "#171717", "#555555", "#333333", "#aaaaaa"]),
    );
    expect(source).toContain("backgroundColor: WHITE");
  });

  it("matches the report export's palette exactly", () => {
    // Two documents from one product printed side by side. They drift when
    // one is edited and nothing compares them.
    const read = (name: string) =>
      readFileSync(fileURLToPath(new URL(`../components/${name}`, import.meta.url)), "utf8");
    const hexes = (source: string) =>
      new Set([...source.matchAll(/"(#[0-9a-fA-F]{6})"/g)].map((match) => match[1]));

    expect(hexes(read("StudyPdf.tsx"))).toEqual(hexes(read("ReportPdf.tsx")));
  });
});
