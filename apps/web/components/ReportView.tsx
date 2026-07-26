import {
  formatLatency,
  formatTimestamp,
  VERDICT_LABELS,
  verdictClasses,
} from "@/lib/report-format";
import type { Channel, Rubric, SessionReport } from "@/lib/types";

export interface DimensionMeta {
  key: string;
  name: string;
  channel: Channel;
}

export function dimensionMetaFromRubric(rubric: Rubric): DimensionMeta[] {
  return rubric.dimensions.map((dimension) => ({
    key: dimension.key,
    name: dimension.name,
    channel: dimension.channel,
  }));
}

export default function ReportView({
  report,
  dimensions,
}: {
  report: SessionReport;
  dimensions: DimensionMeta[];
}) {
  const metaByKey = new Map(dimensions.map((d) => [d.key, d]));
  const metrics = report.delivery_metrics;
  return (
    <div className="flex flex-col gap-10">
      <section className={`rounded-lg border p-6 ${verdictClasses(report.verdict)}`}>
        <p className="text-sm uppercase tracking-wide">Verdict</p>
        <p className="text-3xl font-bold">
          {VERDICT_LABELS[report.verdict]}
          <span className="ml-3 text-xl font-medium">
            {report.overall_score.toFixed(2)} / 5
          </span>
        </p>
        <p className="mt-3 text-sm">{report.limits_note}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Dimension scores</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-300 dark:border-neutral-700">
                <th className="py-2 pr-4">Dimension</th>
                <th className="py-2 pr-4">Channel</th>
                <th className="py-2 pr-4">Score</th>
                <th className="py-2">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {report.dimension_scores.map((score) => {
                const meta = metaByKey.get(score.dimension_key);
                return (
                  <tr
                    key={score.dimension_key}
                    className="border-b border-neutral-200 align-top dark:border-neutral-800"
                  >
                    <td className="py-3 pr-4 font-medium">
                      {meta?.name ?? score.dimension_key}
                    </td>
                    <td className="py-3 pr-4">{meta?.channel ?? "—"}</td>
                    <td className="whitespace-nowrap py-3 pr-4">
                      {score.score.toFixed(1)} / 5
                    </td>
                    <td className="py-3">
                      <ul className="flex flex-col gap-1">
                        {score.evidence_quotes.map((quote) => (
                          <li key={quote} className="text-neutral-600 dark:text-neutral-400">
                            &ldquo;{quote}&rdquo;
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Delivery metrics</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <dt className="text-sm text-neutral-500">Pace</dt>
            <dd className="text-2xl font-semibold">{Math.round(metrics.wpm_overall)} WPM</dd>
          </div>
          <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <dt className="text-sm text-neutral-500">Fillers</dt>
            <dd className="text-2xl font-semibold">
              {metrics.filler_rate_per_min.toFixed(1)} / min
            </dd>
          </div>
          <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <dt className="text-sm text-neutral-500">Silences &ge; 1s</dt>
            <dd className="text-2xl font-semibold">{metrics.silence_events.length}</dd>
          </div>
          <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
            <dt className="text-sm text-neutral-500">Avg response latency</dt>
            <dd className="text-2xl font-semibold">
              {formatLatency(metrics.avg_response_latency_s)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Observations timeline</h2>
        <ol className="flex flex-col gap-3">
          {report.delivery_observations.map((observation) => (
            <li
              key={`${observation.at_s}-${observation.kind}`}
              className="flex items-baseline gap-3 text-sm"
            >
              <span className="font-mono text-neutral-500">
                {formatTimestamp(observation.at_s)}
              </span>
              <span>
                {observation.note}
                {observation.conflicts_with_dsp ? (
                  <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    DSP conflict — differs from measured audio metrics
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Strengths</h2>
          <ul className="list-disc pl-5 text-sm">
            {report.strengths.map((strength) => (
              <li key={strength}>{strength}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Gaps</h2>
          <ul className="list-disc pl-5 text-sm">
            {report.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Next drills</h2>
        <ol className="list-decimal pl-5 text-sm">
          {report.next_drills.map((drill) => (
            <li key={drill}>{drill}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
