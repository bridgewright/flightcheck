export const RATING_MAX = 5;
export const RATING_STEP = 0.5;
export const FEEDBACK_TEXT_MAX = 5000;

export function ratingValues(): number[] {
  return Array.from({ length: RATING_MAX / RATING_STEP }, (_, index) => (index + 1) * RATING_STEP);
}

export function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= RATING_STEP &&
    value <= RATING_MAX && Number.isInteger(value / RATING_STEP);
}

export function toHalfStars(value: number): number { return value * 2; }

export function starGlyphs(value: number | null): ("empty" | "half" | "full")[] {
  return Array.from({ length: RATING_MAX }, (_, index) => {
    const remainder = (value ?? 0) - index;
    return remainder >= 1 ? "full" : remainder >= 0.5 ? "half" : "empty";
  });
}

export function ratingSpoken(value: number): string {
  return `${value} out of 5 stars`;
}
