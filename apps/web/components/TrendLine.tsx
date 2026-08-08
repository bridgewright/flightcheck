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
    width: 640,
    height: 300,
    pad: { x: 40, top: 28, bottom: 36 },
  },
  spark: {
    width: 160,
    height: 44,
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

  return (
    <svg
      viewBox={hero ? "0 0 640 300" : "0 0 160 44"}
      className={hero ? "w-full h-auto" : "h-9 w-40"}
      role="img"
      aria-label={ariaLabel}
    >
      {hero ? (
        <g aria-hidden="true">
          {geometry.gridLines.map((gridLine) => (
            <g key={gridLine.score}>
              <line
                x1={SIZES.hero.pad.x}
                x2={SIZES.hero.width - SIZES.hero.pad.x}
                y1={gridLine.y}
                y2={gridLine.y}
                className="stroke-hairline"
                strokeWidth={1}
              />
              <text
                x={SIZES.hero.pad.x - 10}
                y={gridLine.y + 4}
                textAnchor="end"
                fontSize={11}
                className="fill-ink-faint"
              >
                {gridLine.score}
              </text>
            </g>
          ))}
          {geometry.slots.map((slot) => (
            <text
              key={slot.label}
              x={slot.x}
              y={SIZES.hero.height - 8}
              textAnchor="middle"
              fontSize={11}
              className="fill-ink-faint"
            >
              {slot.label}
            </text>
          ))}
        </g>
      ) : null}
      {geometry.dots.length > 1 ? (
        <polyline
          points={geometry.line}
          fill="none"
          strokeWidth={hero ? 3 : 2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-sky"
          aria-hidden="true"
        />
      ) : null}
      <g aria-hidden="true">
        {geometry.dots.map((dot) => (
          <g key={`${dot.x}-${dot.y}`}>
            <circle
              cx={dot.x}
              cy={dot.y}
              r={hero ? (dot.latest ? 6 : 5) : dot.latest ? 3.5 : 2.5}
              className={dot.latest ? "fill-ink" : "fill-ink-muted"}
            />
            {hero && dot.latest ? (
              <text
                x={dot.x}
                y={dot.y - 12}
                textAnchor="middle"
                fontSize={11}
                className="fill-ink"
              >
                {dot.score.toFixed(1)}
              </text>
            ) : null}
          </g>
        ))}
      </g>
    </svg>
  );
}
