// Contract tests for the retry-compile server action. A server action is a
// public endpoint in disguise (auth-negative-first, like packages-route):
// an anonymous or foreign caller must be refused BEFORE the worker hears
// anything, and worker refusals surface as calm result objects — never as
// thrown errors that would take down the page. The worker client is mocked;
// Track C ships the actual endpoint.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getViewer, retryCompile, listPackagesForUser, MockWorkerError } = vi.hoisted(() => {
  class MockWorkerError extends Error {
    readonly status: number;
    readonly code: string;
    readonly detail: string | null;

    constructor(status: number, code: string, detail: string | null) {
      super(`worker POST failed: ${status}`);
      this.name = "WorkerError";
      this.status = status;
      this.code = code;
      this.detail = detail;
    }
  }
  return {
    getViewer: vi.fn(),
    retryCompile: vi.fn(),
    listPackagesForUser: vi.fn(),
    MockWorkerError,
  };
});

vi.mock("@/lib/viewer", () => ({ getViewer }));
vi.mock("@/lib/worker", () => ({
  WorkerError: MockWorkerError,
  retryCompile,
  listPackagesForUser,
}));

import { retryCompileAction } from "@/app/packages/actions";

function ownedPackage(id: string) {
  return {
    id,
    access_token: `tok-${id}`,
    status: "failed",
    user_id: "viewer-1",
    total_sessions: 6,
    sessions_used: 0,
    role_title: "FDPM",
  };
}

beforeEach(() => {
  getViewer.mockReset();
  getViewer.mockResolvedValue({ id: "viewer-1", email: null });
  retryCompile.mockReset();
  retryCompile.mockResolvedValue(undefined);
  listPackagesForUser.mockReset();
  listPackagesForUser.mockResolvedValue([ownedPackage("pkg-1")]);
});

describe("retryCompileAction", () => {
  it("refuses an anonymous caller before any worker call", async () => {
    getViewer.mockResolvedValue(null);
    const result = await retryCompileAction("pkg-1");
    expect(result.ok).toBe(false);
    expect(retryCompile).not.toHaveBeenCalled();
    expect(listPackagesForUser).not.toHaveBeenCalled();
  });

  it("refuses a package the caller does not own, revealing nothing", async () => {
    const result = await retryCompileAction("someone-elses-pkg");
    expect(result.ok).toBe(false);
    // Same wording an unknown id would get — ownership is not probeable.
    expect(result.error).not.toContain("someone-elses-pkg");
    expect(retryCompile).not.toHaveBeenCalled();
  });

  it("retries an owned package and reports ok", async () => {
    const result = await retryCompileAction("pkg-1");
    expect(result).toEqual({ ok: true });
    expect(retryCompile).toHaveBeenCalledExactlyOnceWith("pkg-1");
  });

  it("surfaces the worker's own refusal detail for non-retryable states", async () => {
    retryCompile.mockRejectedValue(
      new MockWorkerError(409, "not-retryable", "this package is not in a failed state"),
    );
    const result = await retryCompileAction("pkg-1");
    expect(result).toEqual({ ok: false, error: "this package is not in a failed state" });
  });

  it("maps a worker outage to a calm generic message without status codes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      retryCompile.mockRejectedValue(new MockWorkerError(500, "unknown", null));
      const result = await retryCompileAction("pkg-1");
      expect(result.ok).toBe(false);
      expect(result.error).not.toContain("500");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("stays calm when the ownership check itself is unreachable", async () => {
    listPackagesForUser.mockRejectedValue(new Error("fetch failed"));
    const result = await retryCompileAction("pkg-1");
    expect(result.ok).toBe(false);
    expect(retryCompile).not.toHaveBeenCalled();
  });
});
