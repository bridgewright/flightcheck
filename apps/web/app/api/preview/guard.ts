// The per-visitor half of the F-45 preview guards.
//
// The worker enforces the JD cap, a service-level burst window, the global
// daily ceiling, a concurrency slot, and a hard deadline (see
// services/scorer/src/scorer/api/preview.py). What it CANNOT enforce is a
// per-visitor bound: its client is this app, so every browser on earth
// arrives from the same handful of Vercel egress addresses. This module is
// the only layer that sees the visitor, so the per-IP window lives here.
//
// In-process, like the worker's limiters and for the same reason: it bounds
// burst abuse between deploys, and the durable backstop is the worker's daily
// ceiling. Serverless makes that weaker still — several instances mean
// several counters — which is exactly why it is the visitor-facing layer of
// two, not the only one.

// The bounds. jd_min_chars / jd_max_chars mirror PreviewLimits in the worker;
// the worker stays authoritative and this copy exists so an over-long paste
// is refused before it crosses the network. Keep this side at or inside the
// worker's numbers.
export const PREVIEW_JD_MIN_CHARS = 120;
export const PREVIEW_JD_MAX_CHARS = 10_000;

// One visitor, one window: enough to try a couple of roles, not enough to
// script. Refused visitors are told to sign in and compile for real.
export const PREVIEW_WINDOW_MS = 10 * 60 * 1000;
export const PREVIEW_PER_IP = 6;

// How many distinct callers the window will remember at once. Reached, the
// oldest windows are evicted: an unbounded Map keyed by internet-supplied
// addresses is a memory leak anyone can pull.
const MAX_TRACKED_KEYS = 5_000;

// Long enough for an IPv6 address, short enough that a hostile header cannot
// become the key itself.
const MAX_KEY_CHARS = 64;

// Callers we cannot identify share one bucket. Not a free pass, and not a
// per-request key that would make the window meaningless.
const UNKNOWN_KEY = "-unknown-";

/**
 * The visitor's address, as well as this layer can know it.
 *
 * x-forwarded-for's FIRST hop is the client; the entries after it are
 * proxies. Keying on the last hop would put every visitor in one bucket.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const key = forwarded || headers.get("x-real-ip")?.trim() || "";
  return key ? key.slice(0, MAX_KEY_CHARS) : UNKNOWN_KEY;
}

/**
 * Per-key fixed window: `perWindow` hits per `windowMs`.
 *
 * A deliberate mirror of the worker's FixedWindowLimiter
 * (services/scorer/src/scorer/api/guards.py) so the two layers behave the
 * same way under the same abuse: the window is anchored at the first counted
 * hit and refused hits never extend it, so a bursty-but-honest visitor
 * recovers as soon as one full window elapses rather than being locked out
 * for as long as they keep trying.
 *
 * The one addition is eviction, because this side's keys come from the open
 * internet rather than from a signed-in account id.
 */
export class FixedWindow {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly perWindow: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = MAX_TRACKED_KEYS,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  /** Count one hit for `key`; true when it fits the window's budget. */
  hit(key: string): boolean {
    const now = this.now();
    const existing = this.windows.get(key);
    if (existing === undefined || now - existing.start >= this.windowMs) {
      this.evictIfNeeded(now);
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (existing.count >= this.perWindow) {
      return false;
    }
    existing.count += 1;
    return true;
  }

  /**
   * Make room before admitting a new key: expired windows first (they carry
   * no information), then the oldest live ones. Evicting a live window
   * forgives that caller, which is the right way to fail — the alternative is
   * refusing everyone once the map is full, which turns a memory bound into a
   * denial of service against honest visitors.
   */
  private evictIfNeeded(now: number): void {
    if (this.windows.size < this.maxKeys) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) {
        this.windows.delete(key);
      }
    }
    // Map iterates in insertion order, and a key is re-inserted whenever its
    // window restarts, so the front of the map is the least recently started.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done) {
        return;
      }
      this.windows.delete(oldest.value);
    }
  }
}
