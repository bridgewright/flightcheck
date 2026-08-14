// Direction-to-tone for the dimension-trends table, JSX-free so vitest
// exercises it directly (DECISIONS 070). The one rule that matters here:
// direction derives from the SAME one-decimal rounding formatSigned() prints,
// so the wash never claims a rise the printed "0.0" denies. A net of +0.04
// prints "0.0" and reads flat; +0.05 prints "+0.1" and reads rising.
import {
  TREND_FALL_NET,
  TREND_FALL_WASH,
  TREND_FLAT_NET,
  TREND_FLAT_WASH,
  TREND_RISE_NET,
  TREND_RISE_WASH,
} from "@/lib/ui";

export type TrendDirection = "rising" | "flat" | "falling";

/** Which way a net movement reads once rounded for display. */
export function trendDirection(net: number): TrendDirection {
  const rounded = Math.round(net * 10) / 10;
  if (rounded > 0) {
    return "rising";
  }
  if (rounded < 0) {
    return "falling";
  }
  return "flat";
}

/** The sparkline's area fill for each direction. */
export const TREND_WASH: Record<TrendDirection, string> = {
  rising: TREND_RISE_WASH,
  flat: TREND_FLAT_WASH,
  falling: TREND_FALL_WASH,
};

/** The net column's ink for each direction. */
export const TREND_NET: Record<TrendDirection, string> = {
  rising: TREND_RISE_NET,
  flat: TREND_FLAT_NET,
  falling: TREND_FALL_NET,
};
