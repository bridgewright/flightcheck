import { afterEach, describe, expect, it, vi } from "vitest";

import { markTourDone, shouldShowTour } from "./storage";

const storage = (value: string | null = null) => ({
  getItem: vi.fn(() => value),
  setItem: vi.fn(),
});

afterEach(() => vi.unstubAllGlobals());

describe("home tour storage", () => {
  it("is safe during SSR", () => {
    expect(shouldShowTour()).toBe(false);
    expect(() => markTourDone()).not.toThrow();
  });

  it("shows only while the once flag is absent", () => {
    const fake = storage();
    vi.stubGlobal("window", { localStorage: fake });
    expect(shouldShowTour()).toBe(true);
    fake.getItem.mockReturnValue("1");
    expect(shouldShowTour()).toBe(false);
  });

  it("writes the once flag", () => {
    const fake = storage();
    vi.stubGlobal("window", { localStorage: fake });
    markTourDone();
    expect(fake.setItem).toHaveBeenCalledWith("fc-tour-done", "1");
  });
});
