import { describe, expect, it } from "vitest";
import { isValidRating, ratingSpoken, ratingValues, starGlyphs, toHalfStars } from "./feedback";

describe("feedback ratings", () => {
  it("enumerates ten half-star steps", () => expect(ratingValues()).toEqual([0.5,1,1.5,2,2.5,3,3.5,4,4.5,5]));
  it.each([0.5, 3.5, 5])("accepts %s", (value) => expect(isValidRating(value)).toBe(true));
  it.each([0, 5.5, 0.3, "3", NaN])("rejects %s", (value) => expect(isValidRating(value)).toBe(false));
  it("round-trips half stars", () => ratingValues().forEach((value) => expect(toHalfStars(value) / 2).toBe(value)));
  it("builds glyphs", () => {
    expect(starGlyphs(null)).toEqual(["empty","empty","empty","empty","empty"]);
    expect(starGlyphs(2.5)).toEqual(["full","full","half","empty","empty"]);
    expect(starGlyphs(5)).toEqual(["full","full","full","full","full"]);
  });
  it("speaks the rating", () => expect(ratingSpoken(3.5)).toBe("3.5 out of 5 stars"));
});
