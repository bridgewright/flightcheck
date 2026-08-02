import type { Verdict } from "@/lib/types";

const MAX_SCORE = 5;
const SWEEP_DEGREES = 180;

// The arc is drawn as a full conic sweep, then masked down to the band between
// the inner and outer radius. Masking rather than covering the middle with an
// opaque disc: the page behind the dial is a gradient, and a flat disc would
// read as a slightly wrong shade sitting inside it. The outer bound also
// rounds the dial off — without it the gradient's square corners show.
const OUTER_RADIUS = 75;
const RING_WIDTH = 9;
const RING_MASK = `radial-gradient(circle at 50% 100%, transparent 0 ${
  OUTER_RADIUS - RING_WIDTH
}px, #000 ${OUTER_RADIUS - RING_WIDTH}px ${OUTER_RADIUS}px, transparent ${OUTER_RADIUS}px)`;

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
