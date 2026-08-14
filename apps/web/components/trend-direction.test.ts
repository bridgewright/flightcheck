import { describe, expect, it } from "vitest";

import { formatSigned } from "@/components/progress-view";
import { TREND_NET, TREND_WASH, trendDirection } from "@/components/trend-direction";
import {
  TREND_FALL_NET,
  TREND_FALL_WASH,
  TREND_FLAT_NET,
  TREND_FLAT_WASH,
  TREND_RISE_NET,
  TREND_RISE_WASH,
} from "@/lib/ui";

describe("trendDirection", () => {
  it("reads a clear gain as rising, a clear loss as falling, zero as flat", () => {
    expect(trendDirection(0.5)).toBe("rising");
    expect(trendDirection(-0.5)).toBe("falling");
    expect(trendDirection(0)).toBe("flat");
  });

  it("agrees with the printed net everywhere, including the rounding boundary", () => {
    // The colour must never claim a move the printed figure denies:
    // formatSigned rounds to one decimal, so a +0.04 net prints "0.0" and has
    // to read flat, while a +0.05 prints "+0.1" and must not. The two must
    // share one rounding rule, and this sweep is what holds them to it.
    for (let tenth = -30; tenth <= 30; tenth++) {
      for (const jitter of [-0.049, -0.04, 0, 0.04, 0.049]) {
        const net = tenth / 10 + jitter;
        const printed = formatSigned(net);
        const direction = trendDirection(net);
        if (printed === "0.0") {
          expect(direction, `${net} prints "0.0"`).toBe("flat");
        } else if (printed.startsWith("+")) {
          expect(direction, `${net} prints "${printed}"`).toBe("rising");
        } else {
          expect(direction, `${net} prints "${printed}"`).toBe("falling");
        }
      }
    }
  });

  it("maps each direction to its declared wash and net tokens", () => {
    expect(TREND_WASH).toEqual({
      rising: TREND_RISE_WASH,
      flat: TREND_FLAT_WASH,
      falling: TREND_FALL_WASH,
    });
    expect(TREND_NET).toEqual({
      rising: TREND_RISE_NET,
      flat: TREND_FLAT_NET,
      falling: TREND_FALL_NET,
    });
  });

  it("keeps washes as SVG fills and net figures as text inks", () => {
    // A wash is an area fill: it carries no text and never claims to be a
    // ground. The net figure IS text, so its tokens must be text utilities
    // the design-system AA matrix can see.
    for (const wash of Object.values(TREND_WASH)) {
      expect(wash).toMatch(/^fill-[a-z-]+$/);
    }
    for (const net of Object.values(TREND_NET)) {
      expect(net).toMatch(/^text-[a-z-]+$/);
    }
  });

  it("speaks in the pastel pair, not in alarm (DECISIONS 070)", () => {
    // Rising stays in the sky family, flat goes neutral, falling goes to
    // blush, whose declared meaning (work in progress) is exactly what a
    // falling coaching score is. Alarm is reserved for true errors, so no
    // trend token may reach for it.
    expect(TREND_RISE_WASH).toBe("fill-sky");
    expect(TREND_FLAT_WASH).toBe("fill-hairline");
    expect(TREND_FALL_WASH).toBe("fill-blush");
    expect(TREND_RISE_NET).toBe("text-trend-rise");
    expect(TREND_FLAT_NET).toBe("text-ink-faint");
    expect(TREND_FALL_NET).toBe("text-trend-fall");
    for (const token of [...Object.values(TREND_WASH), ...Object.values(TREND_NET)]) {
      expect(token).not.toContain("alarm");
    }
  });
});
