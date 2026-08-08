import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { FEEDBACK_TEXT_MAX, isValidRating, ratingSpoken, ratingValues, starGlyphs, toHalfStars } from "./feedback";

describe("feedback ratings", () => {
  it("enumerates ten half-star steps", () => expect(ratingValues()).toEqual([0.5,1,1.5,2,2.5,3,3.5,4,4.5,5]));
  it.each([0.5, 3.5, 5])("accepts %s", (value) => expect(isValidRating(value)).toBe(true));
  it.each([0, 5.5, 0.3, "3", NaN])("rejects %s", (value) => expect(isValidRating(value)).toBe(false));
  // Exact integers, not just a round-trip: the wire field is an int column
  // with a CHECK, so a 6.999999 here becomes a 422 from the worker.
  it("converts every step to an exact half-star integer", () => expect(ratingValues().map(toHalfStars)).toEqual([1,2,3,4,5,6,7,8,9,10]));
  it("builds glyphs", () => {
    expect(starGlyphs(null)).toEqual(["empty","empty","empty","empty","empty"]);
    expect(starGlyphs(2.5)).toEqual(["full","full","half","empty","empty"]);
    expect(starGlyphs(5)).toEqual(["full","full","full","full","full"]);
  });
  it("speaks the rating", () => expect(ratingSpoken(3.5)).toBe("3.5 out of 5 stars"));
});

// The same single-source gate tests/session-timing-ssot.test.ts applies to the
// session clock. FEEDBACK_TEXT_MAX is a mirror of the worker's limit: the
// textarea's maxLength and the action's pre-check both read it, so if the
// worker lowers its cap without this test the form keeps accepting text the
// API then rejects — a 422 the customer sees only after writing it all.
describe("FEEDBACK_TEXT_MAX single source", () => {
  it("matches limits.feedback_text_max_chars in product.toml", () => {
    const toml = readFileSync(
      fileURLToPath(new URL("../../../services/scorer/config/product.toml", import.meta.url)),
      "utf-8",
    );
    const match = /^feedback_text_max_chars\s*=\s*(\d+)\s*$/m.exec(toml);
    expect(match).not.toBeNull();
    expect(FEEDBACK_TEXT_MAX).toBe(Number(match?.[1]));
  });
});
