import {
  overallNet,
  overallTrend,
} from "@/components/home-dashboard";
import TrendLine from "@/components/TrendLine";
import { formatSigned, SCORE_MAX } from "@/components/progress-view";
import {
  DIVIDER,
  LABEL,
  MUTED,
  SCORE_DENOMINATOR,
  SCORE_NUMBER,
} from "@/lib/ui";
import type { SessionProgressEntry } from "@/lib/worker";

export function overallTrendAriaLabel(
  points: ReturnType<typeof overallTrend>,
  totalSlots: number,
): string {
  const readings = points
    .map(
      (point) =>
        `session ${point.index}, ${point.score.toFixed(1)} out of ${SCORE_MAX}`,
    )
    .join("; ");
  return `Overall score trend: ${points.length} of ${totalSlots} planned sessions scored; ${readings}; net change ${formatSigned(overallNet(points))}.`;
}

export default function OverallTrend({
  entries,
  totalSlots,
}: {
  entries: SessionProgressEntry[];
  totalSlots: number;
}) {
  const points = overallTrend(entries);
  if (points.length === 0) {
    return null;
  }
  const latest = points[points.length - 1];
  const net = overallNet(points);

  return (
    <div className={`border-b pb-5 ${DIVIDER}`}>
      <div className={`${LABEL} mb-2.5`}>Overall trend</div>
      <div className="mb-3 flex items-baseline gap-5">
        <span className="flex items-baseline gap-3">
          <span className={SCORE_NUMBER}>
            {latest.score.toFixed(1)}
            <span className={SCORE_DENOMINATOR}> /{SCORE_MAX}</span>
          </span>
          <span className={MUTED}>{formatSigned(net)}</span>
        </span>
      </div>
      <TrendLine
        points={points.map((point) => ({ slot: point.index, score: point.score }))}
        totalSlots={totalSlots}
        variant="hero"
        ariaLabel={overallTrendAriaLabel(points, totalSlots)}
      />
    </div>
  );
}
