import { describe, expect, it } from "vitest";

import {
  REQUEST_ID_HEADER,
  isNextControlFlowError,
  newRequestId,
  normalizeRequestId,
} from "@/lib/request-id";

describe("REQUEST_ID_HEADER", () => {
  it("is lowercase, because Headers.get is case-insensitive but our tests are not", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });
});

describe("newRequestId", () => {
  it("returns a distinct id each call", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });

  it("returns an id the worker's normalizer accepts", () => {
    // Both sides share one charset and one length bound; an id we generate
    // must never be the one the worker throws away.
    const id = newRequestId();
    expect(normalizeRequestId(id)).toBe(id);
  });
});

describe("normalizeRequestId", () => {
  it("keeps a safe value and trims surrounding whitespace", () => {
    expect(normalizeRequestId("  abc-123._X  ")).toBe("abc-123._X");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["spaces", "has spaces"],
    // A forwarded value carrying CRLF would let an upstream caller inject
    // response headers on the worker side.
    ["crlf", "carriage\r\nreturn"],
    ["overlong", "x".repeat(129)],
    ["non-ascii", "sémantique"],
  ])("refuses %s", (_label, value) => {
    expect(normalizeRequestId(value)).toBeNull();
  });

  it("accepts the maximum length and refuses one more", () => {
    expect(normalizeRequestId("x".repeat(128))).toBe("x".repeat(128));
    expect(normalizeRequestId("x".repeat(129))).toBeNull();
  });
});

describe("isNextControlFlowError", () => {
  it("recognises a throw carrying Next's digest", () => {
    const bailout = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    expect(isNextControlFlowError(bailout)).toBe(true);
    expect(isNextControlFlowError(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT" }))).toBe(
      true,
    );
  });

  it.each([
    ["a plain error", new Error("headers was called outside a request scope")],
    ["a non-string digest", Object.assign(new Error("x"), { digest: 42 })],
    ["null", null],
    ["a string", "boom"],
  ])("does not mistake %s for control flow", (_label, value) => {
    expect(isNextControlFlowError(value)).toBe(false);
  });
});
