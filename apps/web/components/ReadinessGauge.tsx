import type { Verdict } from "@/lib/types";

const MAX_SCORE = 5;
const SWEEP_DEGREES = 180;

// The arc is drawn, then masked into a ring, so the hole is genuinely
// transparent: the page behind it is a gradient, and a solid inner disc would
// read as a slightly wrong shade sitting inside the dial.
const RING_MASK =
  "radial-gradient(circle at 50% 100%, transparent 0 66px, #000 66px)";

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
  const filled = score === null ? 0 : Math.min(Math.max(score / MAX_SCORE, 0), 1);
  const sweep = filled * SWEEP_DEGREES;
  const label = caption(score, verdict);
  return (
    <div className="text-center">
      <h2 className="mb-2.5 text-[11.5px] font-bold tracking-[.1em] text-faint uppercase">
        Readiness
      </h2>
      <div className="relative mx-auto h-[75px] w-[150px]">
        <div
          className="absolute inset-0"
          style={{
            background: `conic-gradient(from 270deg at 50% 100%, var(--color-coral) 0deg ${sweep}deg, var(--color-line) ${sweep}deg ${SWEEP_DEGREES}deg)`,
            mask: RING_MASK,
            WebkitMask: RING_MASK,
          }}
        />
        <span className="absolute inset-x-0 bottom-0 text-center font-data text-[19px] text-ink">
          {score === null ? "—" : score.toFixed(1)}
        </span>
      </div>
      <p
        className={`mt-2 font-data text-[11.5px] tracking-[.05em] ${
          label === "READY" ? "text-good" : "text-faint"
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
