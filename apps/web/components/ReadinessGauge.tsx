import type { Verdict } from "@/lib/types";

const MAX_SCORE = 5;

function caption(score: number | null, verdict: Verdict | null): string {
  if (score === null) {
    // "Not yet ready" is a verdict, and nothing has been scored to earn it.
    return "NOT SCORED YET";
  }
  return verdict === "ready" ? "READY" : "NOT YET READY";
}

export default function ReadinessGauge({
  score,
  verdict = null,
}: {
  score: number | null;
  verdict?: Verdict | null;
}) {
  const label = caption(score, verdict);
  return (
    <div className="text-center">
      <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        Readiness
      </h2>
      {/* Muted when there is nothing to show: at this weight a bold em dash
          reads as a filled bar rather than an absent score. */}
      <div
        className={`text-4xl font-bold tabular-nums ${
          score === null ? "text-neutral-300 dark:text-neutral-700" : ""
        }`}
      >
        {score === null ? "—" : score.toFixed(1)}
      </div>
      <p
        className={`mt-1 text-xs tracking-wide ${
          label === "READY"
            ? "font-semibold text-neutral-900 dark:text-neutral-100"
            : "text-neutral-500"
        }`}
      >
        {label}
      </p>
      <p className="sr-only">
        {score === null
          ? "No session has been scored yet."
          : `Latest overall score ${score.toFixed(1)} out of ${MAX_SCORE}.`}
      </p>
    </div>
  );
}
