import { VERDICT_LABELS } from "@/lib/report-format";
import type { Verdict } from "@/lib/types";
import {
  CHIP,
  CHIP_READY,
  EMPTY_RULE,
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

function offset(value: number): string {
  const clamped = Math.min(Math.max(value, 0), MAX_SCORE);
  return `${(clamped / MAX_SCORE) * 100}%`;
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
        {value === null ? (
          <span className={EMPTY_RULE} aria-hidden="true" />
        ) : (
          <span className={SCORE_NUMBER}>
            {value.toFixed(decimals)}
            <span className={SCORE_DENOMINATOR}> / {MAX_SCORE}</span>
          </span>
        )}
      </div>
      {sub === null ? null : (
        <p className="text-fine text-ink-muted">{sub}</p>
      )}
      <div className="relative mt-0.5 h-3">
        {/* The scale. Decorative: every number it carries is also printed. */}
        <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        {value === null ? null : (
          <>
            <span
              className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-ink"
              style={{ width: offset(value) }}
            />
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink"
              style={{ left: offset(value) }}
            />
          </>
        )}
        <span
          className="absolute inset-y-0 w-px -translate-x-1/2 bg-field"
          style={{ left: offset(threshold) }}
        />
      </div>
      {/* The bar's own label, printed under the bar and ending at it, so it
          can never run off the right edge of a narrow column. */}
      <div className="relative h-3.5">
        <span
          className="absolute inset-y-0 left-0 flex justify-end"
          style={{ width: offset(threshold) }}
        >
          <span className={`${LABEL} pr-1.5 whitespace-nowrap`}>
            {thresholdLabel}
          </span>
        </span>
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
    `The Ready bar is ${READY_OVERALL.toFixed(1)} out of ${MAX_SCORE} overall, ` +
    `with no dimension below ${READY_MIN_DIMENSION.toFixed(1)}.`;
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

  return (
    <div className="flex flex-col gap-2.5">
      <h2 className={LABEL}>Readiness</h2>
      {tracks}
      <span
        className={`self-start ${verdict === "ready" ? CHIP_READY : CHIP}`}
      >
        {verdict === null ? "Not scored yet" : VERDICT_LABELS[verdict]}
      </span>
    </div>
  );
}
