import { describe, expect, it } from "vitest";

import {
  FixedWindow,
  PREVIEW_JD_MAX_CHARS,
  PREVIEW_JD_MIN_CHARS,
  PREVIEW_PER_IP,
  PREVIEW_WINDOW_MS,
  clientKey,
} from "@/app/api/preview/guard";

// The rubric preview is the one model call a stranger can reach, and this
// module is the only layer that can see who the stranger IS — the worker's
// client is this app, not the browser. So the per-visitor window is pinned
// here: the window semantics, the key extraction, and the fact that the key
// space cannot grow without bound (an unbounded Map keyed by internet IPs is
// a memory leak with a public trigger).

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("clientKey", () => {
  it("takes the first hop of x-forwarded-for", () => {
    // Vercel appends the real client as the first entry; later hops are
    // proxies. Trusting the last hop would key every visitor to one proxy.
    expect(clientKey(headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("gives every unidentifiable caller ONE shared key, never a free pass", () => {
    const first = clientKey(headers({}));
    const second = clientKey(headers({ "x-forwarded-for": "   " }));
    expect(first).toBe(second);
    expect(first).not.toBe("");
  });

  it("bounds the key so a hostile header cannot become the map key", () => {
    const long = "9".repeat(500);
    expect(clientKey(headers({ "x-forwarded-for": long })).length).toBeLessThanOrEqual(64);
  });
});

describe("FixedWindow", () => {
  it("allows exactly the budget inside one window", () => {
    const now = 1_000;
    const window = new FixedWindow(1_000, 3, () => now);
    expect([window.hit("a"), window.hit("a"), window.hit("a")]).toEqual([true, true, true]);
    expect(window.hit("a")).toBe(false);
  });

  it("counts each key separately", () => {
    const now = 1_000;
    const window = new FixedWindow(1_000, 1, () => now);
    expect(window.hit("a")).toBe(true);
    expect(window.hit("b")).toBe(true);
    expect(window.hit("a")).toBe(false);
  });

  it("is fixed, not sliding: refused hits do not extend the window", () => {
    let now = 1_000;
    const window = new FixedWindow(1_000, 1, () => now);
    expect(window.hit("a")).toBe(true);
    now = 1_500;
    expect(window.hit("a")).toBe(false);
    now = 2_000; // one full window after the FIRST counted hit
    expect(window.hit("a")).toBe(true);
  });

  it("forgets keys whose window has expired instead of growing forever", () => {
    let now = 0;
    const window = new FixedWindow(1_000, 1, () => now, 4);
    for (let i = 0; i < 4; i += 1) {
      window.hit(`ip-${i}`);
    }
    expect(window.size).toBe(4);
    now = 5_000;
    window.hit("ip-new");
    // The four expired windows are gone; only the live one is held.
    expect(window.size).toBe(1);
  });

  it("stays bounded even when every window is still live", () => {
    let now = 0;
    const window = new FixedWindow(10_000, 1, () => now, 4);
    for (let i = 0; i < 40; i += 1) {
      now += 1;
      window.hit(`ip-${i}`);
    }
    expect(window.size).toBeLessThanOrEqual(4);
    // Eviction takes the oldest windows, so the most recent caller survives.
    expect(window.hit("ip-39")).toBe(false);
  });
});

describe("the shared bounds", () => {
  it("keeps the JD cap at or under what the worker will accept", () => {
    // services/scorer/src/scorer/api/preview.py PreviewLimits is authoritative
    // (jd_min_chars 120, jd_max_chars 10000). This layer refuses early so an
    // over-long paste never crosses the network; it must never be the LOOSER
    // of the two or the honest refusal would arrive from the wrong place.
    expect(PREVIEW_JD_MAX_CHARS).toBeLessThanOrEqual(10_000);
    expect(PREVIEW_JD_MIN_CHARS).toBeGreaterThanOrEqual(120);
  });

  it("leaves room for a visitor comparing a couple of roles", () => {
    expect(PREVIEW_PER_IP).toBeGreaterThanOrEqual(3);
    expect(PREVIEW_WINDOW_MS).toBeGreaterThan(0);
  });
});
