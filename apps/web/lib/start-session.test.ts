import { describe, expect, it } from "vitest";

import { startFailureView } from "@/lib/start-session";

// F-30 web half: the worker's typed refusals reach the browser as
// {error, code} JSON riding the worker's own status. This helper is the
// single mapping from (status, code) to honest copy — the audit's "raw red
// 502 string" dies here. Code wins over status so the worker can refine its
// statuses without the button lying.

describe("startFailureView", () => {
  it("maps 409 to the exhausted state", () => {
    const view = startFailureView(409, "package-exhausted");
    expect(view.kind).toBe("exhausted");
    expect(view.message).toContain("have been used");
    expect(view.retryable).toBe(false);
  });

  it("maps a bare 409 (no code) to exhausted too", () => {
    expect(startFailureView(409, null).kind).toBe("exhausted");
  });

  it("maps 410 to the expired state and keeps the artifacts promise", () => {
    const view = startFailureView(410, "package-expired");
    expect(view.kind).toBe("expired");
    expect(view.message).toContain("30-day");
    expect(view.message).toContain("remain available");
    expect(view.retryable).toBe(false);
  });

  it("lets the code override the status — expired can ride any 4xx", () => {
    expect(startFailureView(409, "package-expired").kind).toBe("expired");
    expect(startFailureView(400, "package-exhausted").kind).toBe("exhausted");
  });

  it("maps the insufficient-terminal code to its own closed state", () => {
    const view = startFailureView(409, "insufficient-terminal");
    expect(view.kind).toBe("insufficient-terminal");
    expect(view.message).toContain("could be scored");
    expect(view.retryable).toBe(false);
  });

  it("maps the worker's live session-terminal spelling to the same closed state, beating the 409 fallback", () => {
    const view = startFailureView(409, "session-terminal");
    expect(view.kind).toBe("insufficient-terminal");
    expect(view.retryable).toBe(false);
  });

  it("maps 429 to a rate-limited state that invites waiting", () => {
    const view = startFailureView(429, "rate-limited");
    expect(view.kind).toBe("rate-limited");
    expect(view.message).toContain("Wait a minute");
    expect(view.retryable).toBe(true);
  });

  it("maps gateway statuses and a dead network to worker-unreachable", () => {
    for (const status of [502, 503, 504, 0]) {
      const view = startFailureView(status, null);
      expect(view.kind).toBe("unreachable");
      expect(view.message).toContain("Nothing was used from your package");
      expect(view.retryable).toBe(true);
    }
  });

  it("maps 401 to a sign-in message and 403 to an ownership message", () => {
    expect(startFailureView(401, null).message).toContain("Sign in");
    expect(startFailureView(403, null).message).toContain("account");
    expect(startFailureView(401, null).kind).toBe("denied");
    expect(startFailureView(403, null).kind).toBe("denied");
  });

  it("states the status honestly for anything unrecognized", () => {
    const view = startFailureView(500, "something-new");
    expect(view.kind).toBe("unknown");
    expect(view.message).toContain("status 500");
    expect(view.retryable).toBe(true);
  });

  it("keeps every line calm — no exclamation marks, no raw error strings", () => {
    const inputs: Array<[number, string | null]> = [
      [409, null],
      [409, "insufficient-terminal"],
      [410, null],
      [429, null],
      [502, null],
      [401, null],
      [403, null],
      [500, null],
      [0, null],
    ];
    for (const [status, code] of inputs) {
      const view = startFailureView(status, code);
      expect(view.title).not.toContain("!");
      expect(view.message).not.toContain("!");
      expect(view.message).not.toContain("worker POST");
    }
  });
});
