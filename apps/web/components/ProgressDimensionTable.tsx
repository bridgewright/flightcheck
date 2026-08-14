import type { DimensionMeta } from "@/components/progress-view";
import {
  formatSigned,
  humanizeDimensionKey,
  SCORE_MAX,
} from "@/components/progress-view";
import { TREND_NET, trendDirection } from "@/components/trend-direction";
import TrendLine from "@/components/TrendLine";
import type { DimensionTrend } from "@/lib/progress";
import { EMPTY_RULE, LABEL, SCORE_NUMBER, SUB_HEADING, TABLE_ROW } from "@/lib/ui";

const CHANNEL_TAGS = { content: "Content", delivery: "Delivery" } as const;

/** Per-dimension score trend: name, channel, sparkline, latest score, and net
 * movement since the first scored session. */
export default function ProgressDimensionTable({
  trends,
  meta,
  totalSlots,
}: {
  trends: DimensionTrend[];
  meta: Record<string, DimensionMeta>;
  totalSlots: number;
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
              // net is 0 under two points by lib/progress contract, so a
              // single scored session reads flat: no claim either way.
              const direction = trendDirection(trend.net);
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
                    <TrendLine
                      points={trend.points.map((point) => ({
                        slot: point.index,
                        score: point.score,
                      }))}
                      totalSlots={totalSlots}
                      variant="spark"
                      direction={direction}
                      ariaLabel={`${dimension?.name ?? humanizeDimensionKey(trend.dimension_key)} score trend across ${totalSlots} planned sessions.`}
                    />
                    <span className="sr-only">
                      {trend.points.map((point) => (
                        <span key={point.session_id}>
                          Session {point.index}: {point.score.toFixed(1)}.{" "}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={`py-2.5 pr-3 text-right ${SCORE_NUMBER}`}>
                    {latest ? latest.score.toFixed(1) : <span className={EMPTY_RULE} aria-hidden="true" />}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {trend.points.length >= 2 ? (
                      <span className={TREND_NET[direction]}>
                        {formatSigned(trend.net)}
                      </span>
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
