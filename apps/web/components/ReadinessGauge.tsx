import Sweep from "@/components/motion/Sweep";
import { VERDICT_LABELS } from "@/lib/report-format";
import type { Verdict } from "@/lib/types";
import {
  CHIP,
  CHIP_READY,
  DIVIDER,
  LABEL,
  MUTED,
  PROSE_WIDTH,
  SCORE_DENOMINATOR,
  SCORE_NUMBER,
} from "@/lib/ui";
import {
  MAX_SCORE,
  READY_MIN_DIMENSION,
  READY_OVERALL,
  type VerdictReading,
} from "@/lib/verdict";

// One instrument, two screens.
//
// On /rubric it draws the two bars with nothing measured against them: this is
// what you are about to be held to. On a report it draws the same two bars with
// the session's reading on them. A visitor who reads the rubric and then the
// report sees one picture twice rather than two unrelated ones, and that
// superimposition IS the honesty claim.
//
// Two tracks, because the rule has two clauses. Ready needs an overall at or
// above its bar AND every dimension at or above the floor, and a single gauge
// with a single threshold would show the sample report's 4.27 sitting
// comfortably past a 4.0 bar next to the word "Approaching", which reads as a
// bug rather than as a rule.
//
// Deliberately NOT a traffic light. There is no red for a low score: a
// candidate's weak dimension is neither a destructive action nor an error, and
// alarm means only those two things here. A value below its bar is ink, drawn
// in the position that says it is below. Sage arrives on the verdict word when
// it is Ready and nowhere else.
//
// Three weights of line carry the whole encoding: hairline is the scale, field
// is the printed bar, ink is your reading. There is no filled background track
// (taste-skill 9.F): the rail is a hairline and the reading is a short rule on
// it, not a progress bar.

/** Where a value sits on the rail, as a percentage of the rail's width. */
function offsetPercent(value: number): number {
  const clamped = Math.min(Math.max(value, 0), MAX_SCORE);
  return (clamped / MAX_SCORE) * 100;
}

/**
 * The transform-only positioner every mark on the rail goes through.
 *
 * The marks used to sit at inline `width` and `left` offsets. Those are
 * exactly the layout properties the motion budget forbids animating
 * (DECISIONS 031/035), and the gauge is the one instrument on these screens
 * that does animate, so its static geometry is written in the vocabulary
 * that is allowed to move: `right-full` parks the wrapper's right edge at
 * the rail's start, and translateX walks it to `at` percent of the rail.
 * Children anchor to the wrapper's right edge, which is the offset itself.
 */
function AtOffset({
  at,
  className,
  children,
}: {
  at: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`absolute inset-y-0 right-full w-full ${className ?? ""}`}
      style={{ transform: `translateX(${at}%)` }}
    >
      {children}
    </span>
  );
}

function Track({
  label,
  sub,
  value,
  decimals,
  threshold,
  thresholdLabel,
}: {
  label: string;
  /** Which dimension this track is about. Absent on the overall track. */
  sub: string | null;
  /** Null draws the bar with no reading against it. */
  value: number | null;
  decimals: number;
  threshold: number;
  thresholdLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={LABEL}>{label}</span>
        {/* Nothing at all when there is no reading, not a placeholder rule.
         *
         * `EMPTY_RULE` is the right token for an empty cell in a table, where
         * a column has to keep its shape and the reader is scanning for a
         * value that would be there. Here it rendered as a short line floating
         * at the top right of an otherwise empty track, with no number beside
         * it and nothing labelling it, and it read as a drawing error rather
         * than as an absence. The verdict chip under the same gauge already
         * says "Not scored yet" in words, so the rule was adding suspicion
         * rather than information. */}
        {value === null ? null : (
          <span className={SCORE_NUMBER}>
            {value.toFixed(decimals)}
            <span className={SCORE_DENOMINATOR}> / {MAX_SCORE}</span>
          </span>
        )}
      </div>
      {sub === null ? null : (
        <p className="text-fine text-ink-muted">{sub}</p>
      )}
      {/* overflow-x-clip does two jobs: the reading's fill spans the full
          rail width and ends at the offset, so this clip IS its left edge;
          and a positioner mid-travel must not spill the page sideways. Clip
          rather than hidden, so no scroll container is created. */}
      <div className="relative mt-0.5 h-3 overflow-x-clip">
        {/* The scale. Decorative: every number it carries is also printed. */}
        <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        {/* The reading sweeps to its place once, on first view: the score is
            a measurement, and the sweep is the instrument taking it (F-58).
            Fill and marker travel as one unit inside the leaf, so they can
            never drift apart mid-sweep. */}
        {value === null ? null : (
          <Sweep percent={offsetPercent(value)}>
            <span className="absolute top-1/2 right-0 h-0.5 w-full -translate-y-1/2 bg-ink" />
            <span className="absolute inset-y-0 right-0 w-0.5 translate-x-1/2 bg-ink" />
          </Sweep>
        )}
        <AtOffset at={offsetPercent(threshold)}>
          <span className="absolute inset-y-0 right-0 w-px translate-x-1/2 bg-field" />
        </AtOffset>
      </div>
      {/* The bar's own label, printed under the bar and ending at it, so it
          can never run off the right edge of a narrow column. */}
      <div className="relative h-3.5">
        <AtOffset at={offsetPercent(threshold)} className="flex justify-end">
          <span className={`${LABEL} pr-1.5 whitespace-nowrap`}>
            {thresholdLabel}
          </span>
        </AtOffset>
      </div>
    </div>
  );
}

/** The reading, said in words. This is the gauge's accessible name: the
 * picture is a picture of a number, so it owes a screen reader the number. */
function spoken(score: number | null, reading: VerdictReading | null): string {
  if (reading === null) {
    return score === null
      ? "No session has been scored yet."
      : `Latest overall score ${score.toFixed(1)} out of ${MAX_SCORE}.`;
  }
  const bar =
    `The Ready bar is ${READY_OVERALL.toFixed(1)} out of ${MAX_SCORE} overall, with no dimension below ${READY_MIN_DIMENSION.toFixed(1)}.`;
  if (score === null) {
    return `${bar} Nothing has been measured against it yet.`;
  }
  const weakest =
    reading.weakest === null
      ? ""
      : ` Weakest dimension ${reading.weakest.name}, ${reading.weakest.score.toFixed(1)} out of ${MAX_SCORE}.`;
  return `${bar} This session scored ${score.toFixed(2)} out of ${MAX_SCORE} overall.${weakest}`;
}

export default function ReadinessGauge({
  score,
  verdict = null,
  reading = null,
}: {
  score: number | null;
  verdict?: Verdict | null;
  /**
   * The two-clause reading from lib/verdict. Present on the report and on
   * /rubric, the two screens that show the whole rule; absent on the overview
   * screens, which have one number and show one track.
   */
  reading?: VerdictReading | null;
}) {
  const tracks = (
    <div
      role="img"
      aria-label={spoken(score, reading)}
      className="flex flex-col gap-4"
    >
      <Track
        label="Overall"
        sub={null}
        value={score}
        decimals={reading === null ? 1 : 2}
        threshold={READY_OVERALL}
        thresholdLabel={`Ready ${READY_OVERALL.toFixed(1)}`}
      />
      {reading === null ? null : (
        <Track
          label="Weakest dimension"
          sub={reading.weakest?.name ?? null}
          value={reading.weakest?.score ?? null}
          decimals={1}
          threshold={READY_MIN_DIMENSION}
          thresholdLabel={`Floor ${READY_MIN_DIMENSION.toFixed(1)}`}
        />
      )}
    </div>
  );

  // With a reading, the caller has already said the verdict at display scale
  // (the report) or has no verdict to say (/rubric), so the gauge carries the
  // sentence instead of repeating the word.
  if (reading !== null) {
    return (
      <div className="flex flex-col gap-3.5">
        {tracks}
        <p className={`${MUTED} ${PROSE_WIDTH}`}>{reading.sentence}</p>
      </div>
    );
  }

  // The rule under the heading is what makes this column agree with whatever
  // stands beside it. On /home the sessions list draws its first row border at
  // exactly `heading + gap`; without this, the gauge's own rail was the first
  // horizontal line on this side, 22px lower and a different weight, and two
  // columns whose only horizontal lines disagree read as a broken row rather
  // than as a list and an instrument. Both columns now derive that y the same
  // way (heading, one gap, one hairline), so it survives a type-scale change
  // instead of matching by a hand-tuned margin.
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className={LABEL}>Readiness</h2>
      <div className={`flex flex-col gap-2.5 border-t pt-3 ${DIVIDER}`}>
        {tracks}
        <span
          className={`self-start ${verdict === "ready" ? CHIP_READY : CHIP}`}
        >
          {verdict === null ? "Not scored yet" : VERDICT_LABELS[verdict]}
        </span>
      </div>
    </div>
  );
}
