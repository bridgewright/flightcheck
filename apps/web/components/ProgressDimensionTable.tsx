import type { DimensionMeta } from "@/components/progress-view";
import {
  formatSigned,
  humanizeDimensionKey,
  SCORE_MAX,
} from "@/components/progress-view";
import type { DimensionTrend, TrendPoint } from "@/lib/progress";
import { EMPTY_RULE, LABEL, SCORE_NUMBER, SUB_HEADING, TABLE_ROW } from "@/lib/ui";

// One bar per scored session: height is the score normalized to the 1..5
// rubric scale, drawn with plain CSS on a fixed track. The number itself is
// in the title and the sr-only text — the bars are the shape, not the data.
function BarDot({ point }: { point: TrendPoint }) {
  const pct = Math.min(Math.max(point.score / SCORE_MAX, 0), 1) * 100;
  return (
    <span
      className="flex h-8 w-2 items-end overflow-hidden rounded-sm bg-paper-sunk"
      title={`Session ${point.index}: ${point.score.toFixed(1)}`}
    >
      <span
        aria-hidden="true"
        className="w-full rounded-sm bg-ink-muted"
        style={{ height: `${pct}%` }}
      />
      <span className="sr-only">
        Session {point.index}: {point.score.toFixed(1)}.
      </span>
    </span>
  );
}

const CHANNEL_TAGS = { content: "Content", delivery: "Delivery" } as const;

/** Per-dimension score trend: name, channel, one bar per scored session,
 * the latest score, and net movement since the first scored session. */
export default function ProgressDimensionTable({
  trends,
  meta,
}: {
  trends: DimensionTrend[];
  meta: Record<string, DimensionMeta>;
}) {
  if (trends.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className={`${LABEL} mb-2.5`}>
        Dimension trends
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-fine">
          <thead>
            <tr className={`border-b border-hairline text-left ${LABEL}`}>
              <th scope="col" className="py-2 pr-3">
                Dimension
              </th>
              <th scope="col" className="py-2 pr-3">
                Trend
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                Latest
              </th>
              <th scope="col" className="py-2 text-right">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {trends.map((trend) => {
              const dimension = meta[trend.dimension_key];
              const latest = trend.points[trend.points.length - 1];
              return (
                <tr
                  key={trend.dimension_key}
                  className={TABLE_ROW}
                >
                  <th scope="row" className="py-2.5 pr-3 text-left">
                    <span className={SUB_HEADING}>
                      {dimension?.name ?? humanizeDimensionKey(trend.dimension_key)}
                    </span>
                    {dimension?.channel ? (
                      <span className={`${LABEL} ml-2`}>
                        {CHANNEL_TAGS[dimension.channel]}
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-end gap-1">
                      {trend.points.map((point) => (
                        <BarDot key={point.session_id} point={point} />
                      ))}
                    </span>
                  </td>
                  <td className={`py-2.5 pr-3 text-right ${SCORE_NUMBER}`}>
                    {latest ? latest.score.toFixed(1) : <span className={EMPTY_RULE} aria-hidden="true" />}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {trend.points.length >= 2 ? (
                      formatSigned(trend.net)
                    ) : (
                      <span className={EMPTY_RULE} aria-hidden="true" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-fine text-ink-faint">
        Net is the latest score minus the first scored session&apos;s, on the
        rubric&apos;s 1-{SCORE_MAX} scale.
      </p>
    </section>
  );
}
