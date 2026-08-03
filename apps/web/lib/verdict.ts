// The verdict rule, and the predicate that explains which half of it decided a
// given report. JSX-free so vitest can exercise it without a React transform.
//
// The rule itself belongs to the worker. It lives in
// services/scorer/config/product.toml [report] and is applied by
// scorer/report/compile.py::_verdict, which reads:
//
//     ready = overall >= ready_overall
//             and every dimension score >= ready_min_dimension
//     approaching = overall >= approaching_overall
//
// Two clauses, and the second one is invisible on a screen unless something
// draws it. That is not a hypothetical: the checked-in sample report, the one
// report every visitor can see, scores 4.27 overall against a 4.0 Ready bar and
// still reads "Approaching", because one dimension is 2.5. A verdict a reader
// cannot reconstruct from what is on the page is worth less than no verdict at
// all, for a product whose whole claim is that its verdicts are arguable.
//
// The three numbers are the web's copy of the worker's, not a fetch of them,
// because /rubric draws both bars before any session exists and there is
// nothing to fetch them from yet. tests/verdict-single-source.test.ts parses
// product.toml and fails if the two copies ever drift.

import { VERDICT_LABELS } from "@/lib/report-format";
import type { DimensionScore, SessionReport, Verdict } from "@/lib/types";

export const READY_OVERALL = 4.0;
export const READY_MIN_DIMENSION = 3.0;
export const APPROACHING_OVERALL = 3.0;

/** Every score in this product is out of five. */
export const MAX_SCORE = 5;

const BAR = READY_OVERALL.toFixed(1);
const FLOOR = READY_MIN_DIMENSION.toFixed(1);
const ENTRY = APPROACHING_OVERALL.toFixed(1);

export interface WeakestDimension {
  key: string;
  /** The rubric's name for it, or the key when no rubric rode along. */
  name: string;
  score: number;
}

/**
 * Which part of the rule the reading turns on. Not a verdict: the verdict is
 * the worker's field and this only ever explains it.
 */
export type VerdictClause =
  /** Nothing measured yet. The bars with no reading against them (/rubric). */
  | "unscored"
  /** Both clauses clear, which is what Ready means. */
  | "both-clear"
  /** The overall clears its bar and a single dimension does not clear the floor. */
  | "dimension-below-floor"
  /** Every dimension clears the floor and the overall is short of its bar. */
  | "overall-below-ready"
  /** Neither clause clears. */
  | "both-open"
  /** The overall is below the Approaching bar. */
  | "below-approaching"
  /** The numbers do not account for the verdict the worker recorded. */
  | "unreconciled";

export interface VerdictReading {
  /**
   * The worker's verdict, never a recomputed one. Null before anything has
   * been scored, which is the state /rubric renders.
   */
  verdict: Verdict | null;
  overall: number | null;
  weakest: WeakestDimension | null;
  clause: VerdictClause;
  /** One sentence naming the clause that decided the verdict. */
  sentence: string;
}

/**
 * The lowest-scoring dimension, or null when a report carries none. Ties keep
 * report order, which is the worker's order, because compile.py sorts stably
 * and this comparison is strict.
 */
export function weakestDimension(
  scores: DimensionScore[],
): DimensionScore | null {
  let weakest: DimensionScore | null = null;
  for (const score of scores) {
    if (weakest === null || score.score < weakest.score) {
      weakest = score;
    }
  }
  return weakest;
}

/**
 * The worker's rule, restated. Used ONLY to check that the printed bars
 * account for the verdict on the report. The screen never renders this: if it
 * disagrees with the worker, the worker wins and the reading says so.
 */
function recomputeVerdict(overall: number, scores: DimensionScore[]): Verdict {
  if (
    overall >= READY_OVERALL &&
    scores.every((score) => score.score >= READY_MIN_DIMENSION)
  ) {
    return "ready";
  }
  return overall >= APPROACHING_OVERALL ? "approaching" : "not_ready";
}

function sentenceFor(
  clause: VerdictClause,
  verdict: Verdict | null,
  overall: number | null,
  weakest: WeakestDimension | null,
): string {
  const total = overall === null ? "" : overall.toFixed(2);
  const low = weakest === null ? "" : weakest.score.toFixed(1);

  switch (clause) {
    case "unscored":
      return (
        `Ready takes both at once: an overall of ${BAR} or better, and no ` +
        `single dimension below ${FLOOR}. Both bars are drawn above, and a ` +
        `session has to clear each of them.`
      );
    case "both-clear":
      return weakest === null
        ? `Overall ${total} clears the ${BAR} bar, and no dimension sits below the ${FLOOR} floor. Both clauses hold, which is what Ready means.`
        : `Overall ${total} clears the ${BAR} bar, and the weakest dimension, ${weakest.name} at ${low}, clears the ${FLOOR} floor. Both clauses hold, which is what Ready means.`;
    case "dimension-below-floor":
      // The clause this whole instrument exists for. Overall clears its bar,
      // so the verdict is always Approaching here and the sentence can name
      // both verdicts by name rather than saying "this".
      return (
        `Overall ${total} clears the ${BAR} Ready bar. The verdict also needs ` +
        `every dimension at ${FLOOR} or better, and ${weakest?.name} is ` +
        `${low}. That second clause is the whole difference between ` +
        `Approaching and Ready.`
      );
    case "overall-below-ready":
      return weakest === null
        ? `Overall ${total} is short of the ${BAR} bar Ready needs.`
        : `Every dimension clears the ${FLOOR} floor, and overall ${total} is short of the ${BAR} bar Ready needs. The overall is the only thing still between this session and Ready.`;
    case "both-open":
      return (
        `Overall ${total} is short of the ${BAR} bar Ready needs, and ` +
        `${weakest?.name} is ${low}, below the ${FLOOR} floor every dimension ` +
        `has to clear. Both clauses are still open.`
      );
    case "below-approaching":
      return weakest === null
        ? `Overall ${total} is below ${ENTRY}, which is the bar for Approaching. Ready is ${BAR} overall with no dimension below ${FLOOR}.`
        : `Overall ${total} is below ${ENTRY}, which is the bar for Approaching. Ready is ${BAR} overall with no dimension below ${FLOOR}; the weakest here is ${weakest.name} at ${low}.`;
    case "unreconciled":
      return (
        `The scorer recorded this session as ` +
        `${verdict === null ? "unscored" : VERDICT_LABELS[verdict]}. The two ` +
        `bars above do not account for that reading, so the verdict shown is ` +
        `the scorer's own and this explanation could not be reconciled with it.`
      );
  }
}

/** The bars with nothing measured against them. What /rubric renders. */
export const UNSCORED_READING: VerdictReading = {
  verdict: null,
  overall: null,
  weakest: null,
  clause: "unscored",
  sentence: sentenceFor("unscored", null, null, null),
};

/**
 * Read a report against the two clauses and say which one decided it.
 *
 * This explains the verdict; it does not compute one. `verdict` on the result
 * is always the worker's field, and when the printed bars cannot account for
 * it the reading says exactly that instead of quietly preferring either side.
 *
 * `names` is the rubric metadata the report page already has. It only improves
 * the label on the weakest dimension, so its absence degrades to the key
 * rather than to a missing sentence.
 */
export function readVerdict(
  report: SessionReport,
  names: { key: string; name: string }[] = [],
): VerdictReading {
  const scores = report.dimension_scores;
  const low = weakestDimension(scores);
  const named = new Map(names.map((meta) => [meta.key, meta.name]));
  const weakest: WeakestDimension | null =
    low === null
      ? null
      : {
          key: low.dimension_key,
          name: named.get(low.dimension_key) ?? low.dimension_key,
          score: low.score,
        };

  const overall = report.overall_score;
  const clause = clauseFor(report, overall, scores, weakest);
  return {
    verdict: report.verdict,
    overall,
    weakest,
    clause,
    sentence: sentenceFor(clause, report.verdict, overall, weakest),
  };
}

function clauseFor(
  report: SessionReport,
  overall: number,
  scores: DimensionScore[],
  weakest: WeakestDimension | null,
): VerdictClause {
  if (recomputeVerdict(overall, scores) !== report.verdict) {
    return "unreconciled";
  }
  if (report.verdict === "not_ready") {
    return "below-approaching";
  }
  const overallClears = overall >= READY_OVERALL;
  const floorClears = weakest === null || weakest.score >= READY_MIN_DIMENSION;
  if (overallClears && floorClears) {
    return "both-clear";
  }
  if (overallClears) {
    return "dimension-below-floor";
  }
  return floorClears ? "overall-below-ready" : "both-open";
}
