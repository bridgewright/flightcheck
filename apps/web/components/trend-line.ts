import { SCORE_MAX } from "@/components/progress-view";

export interface TrendPoint {
  slot: number;
  score: number;
}

export interface TrendGeometry {
  width: number;
  height: number;
  line: string;
  dots: { x: number; y: number; score: number; latest: boolean }[];
  slots: { x: number; label: string }[];
  gridLines: { y: number; score: number }[];
}

export function trendGeometry(
  points: TrendPoint[],
  totalSlots: number,
  size: {
    width: number;
    height: number;
    pad: { x: number; top: number; bottom: number };
  },
): TrendGeometry {
  const sorted = [...points].sort((a, b) => a.slot - b.slot);
  const highestSlot = sorted.reduce((highest, point) => Math.max(highest, point.slot), 0);
  const slotCount = Math.max(0, totalSlots, highestSlot);
  const plotWidth = size.width - size.pad.x * 2;
  const plotHeight = size.height - size.pad.top - size.pad.bottom;
  const xForSlot = (slot: number) =>
    slotCount === 1
      ? size.pad.x + plotWidth / 2
      : size.pad.x + ((slot - 1) * plotWidth) / (slotCount - 1);
  const yForScore = (score: number) =>
    size.pad.top + (1 - score / SCORE_MAX) * plotHeight;

  const dots = sorted.map((point, index) => ({
    x: xForSlot(point.slot),
    y: yForScore(point.score),
    score: point.score,
    latest: index === sorted.length - 1,
  }));

  return {
    width: size.width,
    height: size.height,
    line: dots.map((dot) => `${dot.x},${dot.y}`).join(" "),
    dots,
    slots: Array.from({ length: slotCount }, (_, index) => ({
      x: xForSlot(index + 1),
      label: `S${index + 1}`,
    })),
    gridLines: Array.from({ length: SCORE_MAX }, (_, index) => {
      const score = index + 1;
      return { y: yForScore(score), score };
    }),
  };
}
