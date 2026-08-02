import { describe, expect, it } from "vitest";

import { safeNextPath } from "./auth-redirect";

describe("safeNextPath", () => {
  it.each(["/home", "/p/abc/session/1"])(
    "allows the same-origin path %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([null, undefined, ""])("falls back for %s", (path) => {
    expect(safeNextPath(path)).toBe("/home");
  });

  it.each(["https://evil.com", "//evil.com"])(
    "rejects the external redirect %s",
    (path) => {
      expect(safeNextPath(path)).toBe("/home");
    },
  );

  // WHATWG URL parsing treats "\" as "/" for http(s) and strips \t \n \r,
  // so these all resolve to http://evil.com despite starting with a single
  // "/". A path that passes must never leave the origin it resolves against.
  it.each(["/\\evil.com/phish", "/\\/evil.com", "/\t/evil.com", "/\n/evil.com", "/\r/evil.com"])(
    "rejects the parser-normalization bypass %j",
    (path) => {
      expect(safeNextPath(path)).toBe("/home");
    },
  );

  it("never returns a path that resolves off-origin", () => {
    const hostile = [
      "/\\evil.com",
      "/\t/evil.com",
      "//evil.com",
      "https://evil.com",
      "/ok/path",
      "/p/tok-1",
    ];
    for (const raw of hostile) {
      const resolved = new URL(safeNextPath(raw), "http://web.test");
      expect(resolved.origin).toBe("http://web.test");
    }
  });
});
