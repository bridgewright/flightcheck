import { trendGeometry } from "@/components/trend-line";
import type { TrendPoint } from "@/components/trend-line";

interface TrendLineProps {
  points: TrendPoint[];
  totalSlots: number;
  variant: "hero" | "spark";
  ariaLabel: string;
}

const SIZES = {
  hero: {
    width: 100,
    height: 100,
    pad: { x: 6.25, top: 12, bottom: 12 },
  },
  spark: {
    width: 160,
    height: 36,
    pad: { x: 4, top: 4, bottom: 4 },
  },
} as const;

export default function TrendLine({
  points,
  totalSlots,
  variant,
  ariaLabel,
}: TrendLineProps) {
  const geometry = trendGeometry(points, totalSlots, SIZES[variant]);
  const hero = variant === "hero";
  const baseline = geometry.height - SIZES[variant].pad.bottom;
  const area = geometry.dots.length > 1
    ? `${geometry.line} ${geometry.dots.at(-1)?.x},${baseline} ${geometry.dots[0].x},${baseline}`
    : "";

  if (hero) {
    return (
      <div
        role="img"
        aria-label={ariaLabel}
        className="relative h-56 sm:h-72"
      >
        <div aria-hidden="true">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {geometry.gridLines.map((gridLine) => (
              <line
                key={gridLine.score}
                x1={SIZES.hero.pad.x}
                x2={SIZES.hero.width - SIZES.hero.pad.x}
                y1={gridLine.y}
                y2={gridLine.y}
                className="stroke-hairline"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {area ? (
              <polygon points={area} className="fill-sky" fillOpacity={0.45} stroke="none" />
            ) : null}
            {geometry.dots.length > 1 ? (
              <polyline
                points={geometry.line}
                fill="none"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-ink-muted"
              />
            ) : null}
          </svg>
          {geometry.dots.map((dot) => (
            <span
              key={`${dot.x}-${dot.y}`}
              data-trend-dot
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${dot.latest ? "size-3 bg-ink" : "size-2.5 bg-ink-muted"}`}
              style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
            />
          ))}
          {geometry.dots
            .filter((dot) => dot.latest)
            .map((dot) => (
              <span
                key={`score-${dot.x}-${dot.y}`}
                className="absolute -translate-x-1/2 -translate-y-full text-fine text-ink"
                style={{ left: `${dot.x}%`, top: `${dot.y - 2}%` }}
              >
                {dot.score.toFixed(1)}
              </span>
            ))}
          <div className="absolute inset-x-0 bottom-0 h-5 text-fine text-ink-faint">
            {geometry.slots.map((slot) => (
              <span
                key={slot.label}
                data-slot-label
                className="absolute -translate-x-1/2"
                style={{ left: `${slot.x}%` }}
              >
                {slot.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <svg
      viewBox="0 0 160 36"
      className="h-9 w-40"
      role="img"
      aria-label={ariaLabel}
    >
      <g aria-hidden="true">
        {area ? (
          <polygon points={area} className="fill-sky" fillOpacity={0.45} stroke="none" />
        ) : null}
        {geometry.dots.length > 1 ? (
          <polyline
            points={geometry.line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-ink-muted"
          />
        ) : null}
        {geometry.dots.map((dot) => (
          <circle
            key={`${dot.x}-${dot.y}`}
            cx={dot.x}
            cy={dot.y}
            r={dot.latest ? 3.5 : 2.5}
            className={dot.latest ? "fill-ink" : "fill-ink-muted"}
          />
        ))}
      </g>
    </svg>
  );
}
