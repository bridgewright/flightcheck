import { describe, expect, it } from "vitest";
import { isOperator } from "./operator";

describe("isOperator", () => {
  it("matches exact ids", () => expect(isOperator("abc", "abc")).toBe(true));
  it("rejects mismatches", () => expect(isOperator("abc", "def")).toBe(false));
  it("fails closed for unset or empty ids", () => {
    expect(isOperator("abc", undefined)).toBe(false);
    expect(isOperator("", "abc")).toBe(false);
  });
  it("trims both ids", () => expect(isOperator(" abc ", "  abc")).toBe(true));
});
