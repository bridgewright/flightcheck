import ReadinessGauge from "@/components/ReadinessGauge";
import {
  formatDelta,
  formatLatency,
  formatTimestamp,
  topObservations,
  VERDICT_LABELS,
} from "@/lib/report-format";
import type {
  Channel,
  DeliveryMetrics,
  DimensionScore,
  Rubric,
  SessionReport,
  TimestampedObservation,
} from "@/lib/types";
import {
  CARD,
  CHIP,
  CHIP_BLUSH,
  DIVIDE_Y,
  DIVIDER,
  EVIDENCE_QUOTE,
  FINE_PRINT,
  LABEL,
  MUTED,
  PROSE_WIDTH,
  QUIET_LINK,
  SCORE_DENOMINATOR,
  SCORE_NUMBER,
  SECTION_HEADING,
  SUB_HEADING,
  SUBTLE,
  VERDICT_HEADING,
  VERDICT_READY,
} from "@/lib/ui";
import { splitRationale } from "@/lib/rationale";
import { MAX_SCORE, readVerdict, weakestDimension } from "@/lib/verdict";

// Trimmed-by-default display (user feedback, 2026-08-01): lead with the few
// items that carry the judgment; the full set stays one native <details>
// disclosure away, so nothing is lost and the page needs no client JS.
const MAX_QUOTES = 4;
const MAX_TIMELINE = 5;

// One badge for every surface that renders a judge-vs-measurement
// disagreement (observations timeline here, transcript inline notes in
// TranscriptView): the conflict must look identical wherever it appears.
//
// Blush, not alarm. The judge and the DSP measurement disagreeing is something
// to notice, not something anyone did wrong, and alarm in this product means a
// destructive action or a true error.
export function DspConflictBadge() {
  return (
    <span className={`ml-2 ${CHIP_BLUSH}`}>
      DSP conflict: differs from measured audio metrics
    </span>
  );
}

function ObservationItem({
  observation,
}: {
  observation: TimestampedObservation;
}) {
  return (
    <li className="flex items-baseline gap-3 text-fine">
      <span className="font-mono tabular-nums text-ink-faint">
        {formatTimestamp(observation.at_s)}
      </span>
      <span>
        {observation.note}
        {observation.conflicts_with_dsp ? <DspConflictBadge /> : null}
      </span>
    </li>
  );
}

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

// The report is rendered as exported sections so the session detail page can
// interleave other material (the transcript, the audio replay) between them
// without duplicating any of this. The default export composes them in the
// classic order for pages that want the whole report as one block.

/** The rationale, the two verdict lists, and the quotes. Shared by both shapes
 * a dimension is drawn in, so promoting one to the lead changes its scale and
 * its surroundings and nothing about what it says. */
/**
 * The judge's finding, then the reasoning behind it.
 *
 * The lead sentence is emphasised because it is the finding; the split is
 * positional and lib/rationale.ts explains why it is not semantic. The
 * underline is deliberately quiet: an underline normally means a link, and a
 * heavy rule under 200 characters of prose would both misread as clickable and
 * emphasise so much that nothing stands out.
 */
function RationaleText({ rationale }: { rationale: string }) {
  const { lead, rest } = splitRationale(rationale);
  return (
    <div className={`${PROSE_WIDTH} mt-3 flex flex-col gap-2`}>
      <p className="font-medium text-ink underline decoration-hairline decoration-1 underline-offset-4">
        {lead}
      </p>
      {rest ? <p className={MUTED}>{rest}</p> : null}
    </div>
  );
}

function DimensionBody({ score }: { score: DimensionScore }) {
  // F-03 fields are declared required, but reports serialized before the
  // fields existed (the checked-in sample fixture, cached JSON) omit them at
  // runtime: read defensively, render nothing.
  const strengths = score.strengths ?? [];
  const weaknesses = score.weaknesses ?? [];
  return (
    <>
      <RationaleText rationale={score.rationale} />
      {(strengths.length > 0 || weaknesses.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {strengths.length > 0 && (
            <div>
              <p className={LABEL}>What worked</p>
              <ul className={`${MUTED} mt-1.5 list-disc pl-5 text-fine`}>
                {strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <p className={LABEL}>What held the score down</p>
              <ul className={`${MUTED} mt-1.5 list-disc pl-5 text-fine`}>
                {weaknesses.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {score.evidence_quotes.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className={LABEL}>What you actually said</p>
          {score.evidence_quotes.slice(0, MAX_QUOTES).map((quote) => (
            <blockquote key={quote} className={EVIDENCE_QUOTE}>
              &ldquo;{quote}&rdquo;
            </blockquote>
          ))}
          {score.evidence_quotes.length > MAX_QUOTES && (
            <details>
              <summary className={`${SUBTLE} ${QUIET_LINK} cursor-pointer`}>
                Show {score.evidence_quotes.length - MAX_QUOTES} more quotes
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {score.evidence_quotes.slice(MAX_QUOTES).map((quote) => (
                  <blockquote key={quote} className={EVIDENCE_QUOTE}>
                    &ldquo;{quote}&rdquo;
                  </blockquote>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );
}

function DimensionHeader({
  name,
  channel,
  score,
  before,
  large,
}: {
  name: string;
  channel: Channel | null;
  score: number;
  before: number | undefined;
  large: boolean;
}) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 className={large ? SECTION_HEADING : SUB_HEADING}>{name}</h3>
      {/* Absent when no rubric rode along with the report. An empty pill would
          say less than no pill, and the name above already carries the row. */}
      {channel === null ? null : <span className={CHIP}>{channel}</span>}
      <span className={`${SCORE_NUMBER} ml-auto ${large ? "text-page" : ""}`}>
        {score.toFixed(1)}
        <span className={SCORE_DENOMINATOR}> / {MAX_SCORE}</span>
      </span>
      {before !== undefined ? (
        <span className={`${FINE_PRINT} w-full tabular-nums sm:w-auto`}>
          {formatDelta(score - before)} vs last scored
        </span>
      ) : null}
    </header>
  );
}

export function ReportDimensionCards({
  report,
  dimensions,
  previous,
}: {
  report: SessionReport;
  dimensions: DimensionMeta[];
  /** The previous scored session's scores by dimension key. When a key is
   * present, the card shows its delta: comparable because every session in
   * a package shares the rubric. */
  previous?: Record<string, number>;
}) {
  const metaByKey = new Map(dimensions.map((d) => [d.key, d]));
  const scores = report.dimension_scores;

  // Rhythm, from order and scale alone (design spec 8.3). Six identical cards
  // is section-layout repetition, and it also flattens the one thing the
  // reader has to act on into the same shape as the one they already have.
  // The weakest dimension leads at card scale, the rest follow as rows, and it
  // is the same dimension the gauge names two sections up. No new data: this
  // is the report's own numbers, ordered.
  const low = weakestDimension(scores);
  const distinct = low !== null && scores.some((s) => s.score > low.score);
  const lead = distinct ? low : (scores[0] ?? null);
  const rest = lead === null ? [] : scores.filter((s) => s !== lead);

  const draw = (score: DimensionScore, large: boolean) => {
    const meta = metaByKey.get(score.dimension_key);
    return (
      <DimensionHeader
        name={meta?.name ?? score.dimension_key}
        channel={meta?.channel ?? null}
        score={score.score}
        before={previous?.[score.dimension_key]}
        large={large}
      />
    );
  };

  return (
    <section className="flex flex-col gap-5">
      <h2 className={SECTION_HEADING}>Dimension scores</h2>
      {lead === null ? null : (
        <article className={`${CARD} p-5`}>
          {distinct ? (
            <div className="mb-2.5">
              <span className={CHIP_BLUSH}>Weakest dimension</span>
            </div>
          ) : null}
          {draw(lead, true)}
          <DimensionBody score={lead} />
        </article>
      )}
      {rest.length > 0 && (
        <div className={DIVIDE_Y}>
          {rest.map((score) => (
            <article key={score.dimension_key} className="py-5">
              {draw(score, false)}
              <DimensionBody score={score} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ReportDeliveryMetrics({ metrics }: { metrics: DeliveryMetrics }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING}>Delivery metrics</h2>
      {/* Four measurements, grouped by space above one hairline rather than by
          four more boxes. The dimension list above is already the report's card
          layout, and repeating it here is the repetition tell. */}
      <dl
        className={`grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-4 sm:grid-cols-4 ${DIVIDER}`}
      >
        <div className="flex flex-col">
          <dt className={`${LABEL} flex-1`}>Pace</dt>
          <dd className={`${SCORE_NUMBER} mt-1 text-page`}>
            {Math.round(metrics.wpm_overall)} WPM
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className={`${LABEL} flex-1`}>Fillers</dt>
          <dd className={`${SCORE_NUMBER} mt-1 text-page`}>
            {metrics.filler_rate_per_min.toFixed(1)} / min
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className={`${LABEL} flex-1`}>Silences &ge; 1s</dt>
          <dd className={`${SCORE_NUMBER} mt-1 text-page`}>
            {metrics.silence_events.length}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className={`${LABEL} flex-1`}>Avg response latency</dt>
          <dd className={`${SCORE_NUMBER} mt-1 text-page`}>
            {formatLatency(metrics.avg_response_latency_s)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function ReportObservations({
  observations,
}: {
  observations: TimestampedObservation[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_HEADING}>Observations timeline</h2>
      <ol className="flex flex-col gap-3">
        {topObservations(observations, MAX_TIMELINE).map((observation) => (
          <ObservationItem
            key={`${observation.at_s}-${observation.kind}`}
            observation={observation}
          />
        ))}
      </ol>
      {observations.length > MAX_TIMELINE && (
        <details>
          <summary className={`${SUBTLE} ${QUIET_LINK} cursor-pointer`}>
            Show the full timeline ({observations.length} observations)
          </summary>
          <ol className="mt-3 flex flex-col gap-3">
            {observations.map((observation) => (
              <ObservationItem
                key={`full-${observation.at_s}-${observation.kind}`}
                observation={observation}
              />
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

export function ReportOutcomes({ report }: { report: SessionReport }) {
  return (
    <>
      <section className="grid gap-8 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className={SECTION_HEADING}>Strengths</h2>
          <ul className="list-disc pl-5 text-fine">
            {report.strengths.map((strength) => (
              <li key={strength}>{strength}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className={SECTION_HEADING}>Gaps</h2>
          <ul className="list-disc pl-5 text-fine">
            {report.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_HEADING}>Next drills</h2>
        <ol className="list-decimal pl-5 text-fine">
          {report.next_drills.map((drill) => (
            <li key={drill}>{drill}</li>
          ))}
        </ol>
      </section>
    </>
  );
}

/**
 * The verdict, at display scale, over the instrument that produced it.
 *
 * Exported because two screens show a verdict and they must not drift: this
 * one and the session detail a paying customer reads after a session. That
 * screen used to render its own coloured band, so the verdict-first
 * typography and the gauge reached the public sample report and not the
 * screen anyone actually pays for.
 *
 * `children` is where a caller adds what only it has. The session detail puts
 * its comparison against the previous session there; the sample report has no
 * previous session and passes nothing.
 */
export function ReportVerdict({
  report,
  dimensions,
  showLimitsNote = true,
  children,
}: {
  report: SessionReport;
  dimensions: DimensionMeta[];
  /** Off where the caller already shows the limits note in a banner above. */
  showLimitsNote?: boolean;
  children?: React.ReactNode;
}) {
  // Verdict first (design spec 7.1). What shipped before was a coloured band
  // containing small text, which is the visual language of a form validation
  // error rather than of a judgment: the verdict is the product's output and it
  // is set at display scale, with the score beside it, the instrument that
  // produced it underneath, and the caveat below rather than inside a box.
  const reading = readVerdict(report, dimensions);
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className={report.verdict === "ready" ? VERDICT_READY : VERDICT_HEADING}>
          {VERDICT_LABELS[report.verdict]}
        </h2>
        <p className={`${SCORE_NUMBER} text-page`}>
          {report.overall_score.toFixed(2)}
          <span className={SCORE_DENOMINATOR}> / {MAX_SCORE}</span>
        </p>
      </div>
      {/* F-03 headline; reports stored before the field carry "". */}
      {report.headline ? <p className={PROSE_WIDTH}>{report.headline}</p> : null}
      <div className="max-w-md">
        <ReadinessGauge
          score={report.overall_score}
          verdict={report.verdict}
          reading={reading}
        />
      </div>
      {children}
      {showLimitsNote ? (
        <p className={`${FINE_PRINT} ${PROSE_WIDTH}`}>{report.limits_note}</p>
      ) : null}
    </section>
  );
}

export default function ReportView({
  report,
  dimensions,
  previous,
}: {
  report: SessionReport;
  dimensions: DimensionMeta[];
  previous?: Record<string, number>;
}) {
  return (
    <div className="flex flex-col gap-10">
      <ReportVerdict report={report} dimensions={dimensions} />

      <ReportDimensionCards
        report={report}
        dimensions={dimensions}
        previous={previous}
      />
      <ReportDeliveryMetrics metrics={report.delivery_metrics} />
      <ReportObservations observations={report.delivery_observations} />
      <ReportOutcomes report={report} />
    </div>
  );
}
