import { beforeEach, describe, expect, it, vi } from "vitest";

// The public face of F-45: the one route in this app an anonymous visitor can
// use to make the product spend money. What is pinned here is mostly what it
// REFUSES, plus the property that makes it publishable at all — the worker
// token never leaves the server, and no worker detail reaches the browser.

const { previewRubric, FakeWorkerError } = vi.hoisted(() => ({
  previewRubric: vi.fn(),
  // The real WorkerError's shape (status / code / detail, message
  // "worker {label} failed: {status}"), declared inside the hoisted block so
  // the mock factory can reference it.
  FakeWorkerError: class extends Error {
    status: number;
    code: string;
    detail: string | null;
    constructor(status: number, code: string, detail: string | null) {
      super(`worker POST /api/preview/rubric failed: ${status}`);
      this.name = "WorkerError";
      this.status = status;
      this.code = code;
      this.detail = detail;
    }
  },
}));

vi.mock("@/lib/worker", () => ({ previewRubric, WorkerError: FakeWorkerError }));

import { POST } from "@/app/api/preview/rubric/route";
import { PREVIEW_JD_MAX_CHARS, PREVIEW_PER_IP } from "@/app/api/preview/guard";

const PREVIEW = {
  role_title: "Forward Deployed Product Manager",
  company: "Acme",
  dimensions: [
    { key: "discovery", name: "Customer discovery", weight: 0.6, channel: "content" },
    { key: "clarity", name: "Spoken clarity", weight: 0.4, channel: "delivery" },
  ],
};

const JD = "We are hiring a forward deployed product manager. ".repeat(6);

let visitor = 0;

function request(body: unknown, ip?: string): Request {
  // A fresh address per case by default: the per-IP window is process state
  // that outlives one test, so cases that are not ABOUT the window must not
  // spend each other's budget.
  visitor += 1;
  return new Request("http://web.test/api/preview/rubric", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? `198.51.100.${visitor % 250}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  previewRubric.mockReset();
  previewRubric.mockResolvedValue(PREVIEW);
});

describe("POST /api/preview/rubric", () => {
  it("returns the compiled bar for a pasted JD", async () => {
    const res = await POST(request({ jd_text: JD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PREVIEW);
    // Trimmed on the way through: leading and trailing whitespace is a paste
    // artefact, and it must not be what tips a JD over the length cap.
    expect(previewRubric).toHaveBeenCalledWith(JD.trim());
  });

  it("refuses a non-JSON body without calling the worker", async () => {
    const res = await POST(
      new Request("http://web.test/api/preview/rubric", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(previewRubric).not.toHaveBeenCalled();
  });

  it("refuses a missing or non-string jd_text without calling the worker", async () => {
    for (const body of [{}, { jd_text: 42 }, { jd_text: null }]) {
      const res = await POST(request(body));
      expect(res.status).toBe(400);
    }
    expect(previewRubric).not.toHaveBeenCalled();
  });

  it("refuses a too-short paste locally, with copy that says what to do", async () => {
    const res = await POST(request({ jd_text: "hire me" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("preview-too-short");
    expect(body.error).toMatch(/job description/i);
    expect(previewRubric).not.toHaveBeenCalled();
  });

  it("refuses an over-long paste before it crosses the network", async () => {
    const res = await POST(request({ jd_text: "x".repeat(PREVIEW_JD_MAX_CHARS + 1) }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("preview-too-long");
    expect(previewRubric).not.toHaveBeenCalled();
  });

  it("rate-limits one visitor without touching another", async () => {
    const mine = "203.0.113.42";
    for (let i = 0; i < PREVIEW_PER_IP; i += 1) {
      expect((await POST(request({ jd_text: JD }, mine))).status).toBe(200);
    }
    const refused = await POST(request({ jd_text: JD }, mine));
    expect(refused.status).toBe(429);
    const body = await refused.json();
    expect(body.code).toBe("preview-rate-limited");
    // The honest degraded state always names the way through.
    expect(body.error).toMatch(/sign in/i);
    expect(previewRubric).toHaveBeenCalledTimes(PREVIEW_PER_IP);

    expect((await POST(request({ jd_text: JD }, "203.0.113.43"))).status).toBe(200);
  });

  it("passes the worker's own refusal through with its code intact", async () => {
    // The busy/ceiling state is the feature's honest degraded mode, so it has
    // to survive the hop: the widget switches on the code, never the message.
    previewRubric.mockRejectedValue(
      new FakeWorkerError(429, "preview-ceiling", "the preview is busy right now"),
    );
    const res = await POST(request({ jd_text: JD }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("preview-ceiling");
    expect(body.error).toMatch(/sign in/i);
  });

  it("never blames the visitor for a limit the worker hit on its own", async () => {
    // The worker's burst window keys on ITS client, which is this app — so
    // "rate limited" there is service-level saturation, not this visitor
    // asking too often (that window is ../guard.ts and it passed). A first
    // paste must not be answered with "that is a few previews in a short
    // while", which would be a sentence about somebody else.
    previewRubric.mockRejectedValue(
      new FakeWorkerError(429, "preview-rate-limited", "service window"),
    );
    const res = await POST(request({ jd_text: JD }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("preview-busy");
    expect(body.error).not.toMatch(/a few previews/i);
    expect(body.error).toMatch(/busy/i);
  });

  it("turns an unexpected worker failure into one calm state", async () => {
    previewRubric.mockRejectedValue(new FakeWorkerError(500, "unknown", "boom"));
    const res = await POST(request({ jd_text: JD }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("preview-failed");
  });

  it("never leaks worker internals to the browser", async () => {
    previewRubric.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:8080 Bearer wk_live_secret"),
    );
    const res = await POST(request({ jd_text: JD }));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toMatch(/ECONNREFUSED|Bearer|10\.0\.0\.4/);
  });

  it("is a public route and says so — no store, no shared cache", async () => {
    const res = await POST(request({ jd_text: JD }));
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("the route source", () => {
  it("never mentions the worker token", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../app/api/preview/rubric/route.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("WORKER_API_TOKEN");
    expect(source).not.toContain("WORKER_URL");
  });
});
