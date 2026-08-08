import {
  overallNet,
  overallTrend,
} from "@/components/home-dashboard";
import { formatSigned, SCORE_MAX } from "@/components/progress-view";
import {
  DIVIDER,
  LABEL,
  MUTED,
  SCORE_DENOMINATOR,
  SCORE_NUMBER,
} from "@/lib/ui";
import type { SessionProgressEntry } from "@/lib/worker";

function spoken(points: ReturnType<typeof overallTrend>): string {
  const first = points[0];
  const latest = points[points.length - 1];
  return `Overall score trend from ${first.score.toFixed(1)} out of ${SCORE_MAX} in session ${first.index} to ${latest.score.toFixed(1)} out of ${SCORE_MAX} in session ${latest.index}, a net change of ${formatSigned(overallNet(points))}.`;
}

export default function OverallTrend({
  entries,
}: {
  entries: SessionProgressEntry[];
}) {
  const points = overallTrend(entries);
  if (points.length === 0) {
    return null;
  }
  const latest = points[points.length - 1];
  const net = overallNet(points);

  return (
    <div role="img" aria-label={spoken(points)} className={`border-b pb-5 ${DIVIDER}`}>
      <div className={`${LABEL} mb-2.5`}>Overall trend</div>
      <div className="flex items-end justify-between gap-5">
        <span className="flex items-end gap-1.5">
          {points.map((point, position) => {
            const pct = Math.min(Math.max(point.score / SCORE_MAX, 0), 1) * 100;
            const latestPoint = position === points.length - 1;
            return (
              <span
                key={point.index}
                className="flex h-12 w-3 items-end overflow-hidden rounded-full bg-paper-sunk"
                title={`Session ${point.index}: ${point.score.toFixed(1)}`}
              >
                <span
                  aria-hidden="true"
                  className={`w-full rounded-full ${latestPoint ? "bg-ink" : "bg-ink-muted"}`}
                  style={{ height: `${pct}%` }}
                />
              </span>
            );
          })}
        </span>
        <span className="flex items-baseline gap-3">
          <span className={SCORE_NUMBER}>
            {latest.score.toFixed(1)}
            <span className={SCORE_DENOMINATOR}> /{SCORE_MAX}</span>
          </span>
          <span className={MUTED}>{formatSigned(net)}</span>
        </span>
      </div>
    </div>
  );
}
