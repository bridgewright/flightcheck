import { describe, expect, it } from "vitest";

import {
  EXPIRY_DAYS,
  PACKAGE_SESSIONS,
  PRICE_DISPLAY,
  PRICE_USD,
  TRIAL_SESSIONS,
} from "@/lib/pricing";

// Pinning test: these constants ARE the commercial policy (v0.5, user-
// confirmed). Every surface — pricing page, checkout, legal terms, expiry
// copy — must read them from here, so a change fails loudly in exactly one
// place instead of drifting across pages.
describe("pricing constants", () => {
  it("pins the $49 price", () => {
    expect(PRICE_USD).toBe(49);
    expect(PRICE_DISPLAY).toBe("$49");
  });

  it("pins the package model: 6 paid sessions, 1 trial session, 30 days", () => {
    expect(PACKAGE_SESSIONS).toBe(6);
    expect(TRIAL_SESSIONS).toBe(1);
    expect(EXPIRY_DAYS).toBe(30);
  });
});
