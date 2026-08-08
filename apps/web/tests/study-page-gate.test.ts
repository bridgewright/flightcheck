// The /study page's gate: which of six states the customer is in, what each
// one is allowed to render, and how the generate action refuses.
//
// The page has no test-visible render (no DOM in this suite), so the state
// machine is pinned as a unit and the branch structure by reading the source.
// A source scan is a weak test in general; it is the right one here for the
// two properties that are structural rather than computed — PollRefresh must
// exist in exactly one branch, and the worker-down branch must not offer a
// button whose action cannot reach the worker.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scoredCount, studyState } from "@/lib/study";
import type { PackageStudy } from "@/lib/types";

const { getViewer, generatePackageStudy, listPackagesForUser, MockWorkerError } = vi.hoisted(() => {
  class MockWorkerError extends Error {
    readonly status: number;
    readonly code: string;
    readonly detail: string | null;
    constructor(status: number, code: string, detail: string | null = null) {
      super(`worker POST failed: ${status}`);
      this.name = "WorkerError";
      this.status = status;
      this.code = code;
      this.detail = detail;
    }
  }
  return {
    getViewer: vi.fn(),
    generatePackageStudy: vi.fn(),
    listPackagesForUser: vi.fn(),
    MockWorkerError,
  };
});

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  WorkerError: MockWorkerError,
  generatePackageStudy,
  listPackagesForUser,
}));

const { generateStudyAction } = await import("@/app/study/actions");

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const study = (overrides: Partial<PackageStudy> = {}): PackageStudy => ({
  package_id: "pkg-1",
  status: "ready",
  stale: false,
  generated_at: "2026-08-08T12:00:00Z",
  doc: {
    schema_version: 1,
    source_session_ids: ["sess-1"],
    summary: { core_problems: [], improvement_strategy: [], priority_expressions: [] },
    jd_core_answers: [],
  },
  ...overrides,
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  session_id: "sess-1",
  index: 1,
  created_at: null,
  status: "scored",
  verdict: "approaching",
  overall: 3.2,
  dimension_scores: [],
  wpm_overall: null,
  filler_rate_per_min: null,
  ...overrides,
}) as never;

// --- the state machine ----------------------------------------------------

describe("studyState covers every state the page renders", () => {
  it("has nothing to build from before a session is scored", () => {
    expect(studyState(null, 0)).toBe("no_sessions");
    expect(studyState(study({ status: "none", doc: null }), 0)).toBe("no_sessions");
  });

  it("offers a build once a scored session exists", () => {
    expect(studyState(study({ status: "none", doc: null }), 1)).toBe("not_generated");
  });

  it("treats an unreachable worker as not-generated, and the page splits it", () => {
    // A null study is "the worker did not answer", not "no guide exists".
    // The state is deliberately shared so the page has one content branch;
    // the distinction lives in the page and is pinned below, because
    // offering a Generate button whose action cannot reach the worker is a
    // button that fails on click.
    expect(studyState(null, 3)).toBe("not_generated");
  });

  it("reports a build in flight", () => {
    expect(studyState(study({ status: "generating", doc: null }), 1)).toBe("generating");
  });

  it("reports a failed build even when a previous document survives", () => {
    expect(studyState(study({ status: "failed" }), 1)).toBe("failed");
  });

  it("separates a current guide from one the sessions have moved past", () => {
    expect(studyState(study({ stale: false }), 1)).toBe("fresh");
    expect(studyState(study({ stale: true }), 1)).toBe("stale");
  });

  it("lets no_sessions win over any stored document", () => {
    // Every scored session was deleted. The guide quotes evidence that is
    // gone, so the page goes back to explaining what study material is.
    expect(studyState(study({ stale: true }), 0)).toBe("no_sessions");
  });
});

describe("scoredCount counts the sessions the worker would build from", () => {
  it("counts scored sessions", () => {
    expect(scoredCount([entry(), entry({ session_id: "sess-2" })])).toBe(2);
  });

  it("ignores sessions that never produced a report", () => {
    // Mirrors the worker's own eligibility filter: a session row reaches
    // status "scored" exactly when a report was saved for it, and a report
    // below the F-04 floor lands as "insufficient" with no report at all.
    expect(scoredCount([
      entry(),
      entry({ session_id: "sess-2", status: "planned", overall: null }),
      entry({ session_id: "sess-3", status: "scoring", overall: null }),
      entry({ session_id: "sess-4", status: "insufficient", overall: null }),
      entry({ session_id: "sess-5", status: "failed", overall: null }),
    ])).toBe(1);
  });

  it("is zero for a package with no sessions", () => {
    expect(scoredCount([])).toBe(0);
  });
});

// --- what each branch of the page is allowed to render --------------------

describe("the /study page's branch structure", () => {
  const page = source("../app/study/page.tsx");

  it("polls in the generating branch and nowhere else", () => {
    // Polling from a settled state is the bug that turns a finished page
    // into a permanent background request loop.
    expect(page.match(/<PollRefresh/g)).toHaveLength(1);
    expect(page.indexOf("<PollRefresh")).toBeGreaterThan(page.indexOf('state === "generating"'));
    expect(page.indexOf("<PollRefresh")).toBeLessThan(page.indexOf('state === "failed"'));
  });

  it("offers the generate button only when the worker answered", () => {
    const notGenerated = page.slice(
      page.indexOf('state === "not_generated"'),
      page.indexOf('state === "generating"'),
    );
    expect(notGenerated).toContain("study === null");
    expect(notGenerated).toContain("study !== null ? <GenerateStudyButton");
  });

  it("renders on every request rather than from the build", () => {
    // Study status changes while the customer watches it.
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("shows saved expressions whether or not a guide was ever generated", () => {
    // Bookmarks are a live join, independent of the generated document
    // (DECISIONS 050). A customer who has saved phrases but never pressed
    // Generate must still find them here.
    expect(page).toContain("<SavedOnly bookmarks={bookmarks} />");
    expect(page).toContain("bookmarks={bookmarks}");
  });

  it("speaks the design system's error register rather than re-typing it", () => {
    // ERROR_TEXT is "text-fine text-alarm". Writing the value inline passes
    // the token scan (both halves are semantic tokens) while putting the
    // page outside the vocabulary — the exact drift lib/ui.ts exists to stop.
    expect(page).toContain("className={ERROR_TEXT}");
    expect(page).not.toContain('className="text-fine text-alarm"');
  });

  it("keeps a failed build's earlier guide on the page", () => {
    expect(page).toContain("Your sessions and any earlier guide are safe");
  });
});

describe("the study guide's export buttons", () => {
  const view = source("../components/StudyGuideView.tsx");

  it("are offered only for a document the export route will actually serve", () => {
    // The route 404s anything that is not status "ready". A download button
    // rendered beside a failed build's stale document is a button that
    // answers 404 — so the page passes showExports for ready states only.
    const page = source("../app/study/page.tsx");
    expect(page).toContain('showExports={state === "fresh" || state === "stale"}');
    expect(view).toContain("showExports ?");
  });

  it("gates every section on having something to put under the heading", () => {
    // The empty case is routine, not exceptional: the generator drops every
    // model answer whose quotes it cannot find in the candidate's own words,
    // so "Answers to memorize" with zero answers is a normal document. A
    // heading standing over nothing reads as a page that failed to load.
    expect(view).toContain("hasSummary(doc.summary) ?");
    expect(view).toContain("savedSessions(bookmarks).length > 0 ?");
    expect(view).toContain("doc.jd_core_answers.length > 0 ?");
  });

  it("download rather than navigate, in both formats", () => {
    expect(view).toContain("format=md");
    expect(view).toContain("format=pdf");
    expect(view.match(/<a download/g)).toHaveLength(2);
  });
});

describe("the proxy already routes /study", () => {
  it("is covered by the matcher Phase 0 owns", () => {
    // Read-only assertion: this track does not own proxy.ts, and a signed-out
    // /study would otherwise render the sign-in fallback with no redirect.
    expect(source("../proxy.ts")).toContain("/study");
  });
});

// --- the server action ----------------------------------------------------

describe("generateStudyAction", () => {
  const submit = (packageId = "pkg-1") => {
    const form = new FormData();
    form.set("packageId", packageId);
    return generateStudyAction({ ok: false }, form);
  };

  beforeEach(() => {
    getViewer.mockReset();
    generatePackageStudy.mockReset();
    listPackagesForUser.mockReset();
    getViewer.mockResolvedValue({ id: "viewer-1", email: null });
    generatePackageStudy.mockResolvedValue(undefined);
    listPackagesForUser.mockResolvedValue([{ id: "pkg-1", user_id: "viewer-1" }]);
  });

  it("refuses an anonymous caller before the worker hears anything", async () => {
    // A server action is a public endpoint in disguise.
    getViewer.mockResolvedValue(null);

    const result = await submit();

    expect(result.ok).toBe(false);
    expect(listPackagesForUser).not.toHaveBeenCalled();
    expect(generatePackageStudy).not.toHaveBeenCalled();
  });

  it("refuses a package the caller does not own, revealing nothing", async () => {
    const result = await submit("someone-elses-pkg");

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("someone-elses-pkg");
    expect(generatePackageStudy).not.toHaveBeenCalled();
  });

  it("refuses a missing package id without calling the worker", async () => {
    const result = await generateStudyAction({ ok: false }, new FormData());

    expect(result.ok).toBe(false);
    expect(generatePackageStudy).not.toHaveBeenCalled();
  });

  it("starts the build for an owned package", async () => {
    expect(await submit()).toEqual({ ok: true });
    expect(generatePackageStudy).toHaveBeenCalledExactlyOnceWith("pkg-1");
  });

  it.each([
    ["study-generating", 409, "already being built"],
    ["no-scored-sessions", 409, "Score a session"],
    ["package-expired", 410, "expired"],
  ])("turns the worker's %s refusal into a sentence", async (code, status, phrase) => {
    // Each of these is a different thing for the customer to do next. Falling
    // through to the generic message would tell them to "try again" when the
    // answer is "score a session first".
    generatePackageStudy.mockRejectedValue(new MockWorkerError(status, code));

    const result = await submit();

    expect(result.ok).toBe(false);
    expect(result.error).toContain(phrase);
  });

  it("asks the customer to wait when they are rate limited", async () => {
    generatePackageStudy.mockRejectedValue(new MockWorkerError(429, "rate-limited"));

    const result = await submit();

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Wait a few minutes");
  });

  it("stays calm and numberless on a worker outage", async () => {
    generatePackageStudy.mockRejectedValue(new MockWorkerError(500, "unknown"));

    const result = await submit();

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("500");
  });

  it("stays calm when the ownership check itself is unreachable", async () => {
    listPackagesForUser.mockRejectedValue(new Error("fetch failed"));

    const result = await submit();

    expect(result.ok).toBe(false);
    expect(generatePackageStudy).not.toHaveBeenCalled();
  });
});
