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
});
