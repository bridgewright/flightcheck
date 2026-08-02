import { describe, expect, it } from "vitest";

import { claimAction } from "./package-claim";

// The /p/[token] page is a claim/redirect route: what happens when a package
// link is opened depends only on who is looking and who owns the package.
// These four outcomes are the whole S15 decision table.

describe("claimAction", () => {
  it("sends a signed-out visitor to login, whoever owns the package", () => {
    expect(claimAction(null, null)).toBe("login");
    expect(claimAction(null, "owner-1")).toBe("login");
  });

  it("claims an unowned package for the signed-in viewer", () => {
    expect(claimAction("viewer-1", null)).toBe("claim");
  });

  it("lets the owner straight through", () => {
    expect(claimAction("viewer-1", "viewer-1")).toBe("enter");
  });

  it("forbids a signed-in viewer who is not the owner", () => {
    expect(claimAction("viewer-1", "owner-2")).toBe("forbidden");
  });
});
