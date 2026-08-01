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

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Dimension scores</h2>
        {/* One card per dimension: the score, the judge's written rationale
            (why this score — previously computed but never rendered), and
            the candidate's own verified words as quotes. */}
        {report.dimension_scores.map((score) => {
          const meta = metaByKey.get(score.dimension_key);
          return (
            <article
              key={score.dimension_key}
              className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
            >
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold">
                  {meta?.name ?? score.dimension_key}
                </h3>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
                  {meta?.channel ?? "—"}
                </span>
                <span className="ml-auto text-lg font-semibold tabular-nums">
                  {score.score.toFixed(1)}
                  <span className="text-sm font-normal text-neutral-500">
                    {" "}
                    / 5
                  </span>
                </span>
              </header>
              <p className="mt-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                {score.rationale}
              </p>
              {score.evidence_quotes.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">
                    What you actually said
                  </p>
                  {score.evidence_quotes.map((quote) => (
                    <blockquote
                      key={quote}
                      className="border-l-2 border-neutral-300 pl-3 text-sm italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                    >
                      &ldquo;{quote}&rdquo;
                    </blockquote>
                  ))}
                </div>
              )}
            </article>
          );
        })}
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
