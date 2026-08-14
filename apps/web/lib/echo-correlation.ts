// Coarse, 4 Hz level-envelope correlation for the shadow echo verdict.
// This measures shape at 250 ms resolution, not waveform alignment. The
// returned sample count keeps that limited resolution visible in the trail.
//
// READ `n` BEFORE READING `r`. The coefficient is the MAXIMUM over the nine
// searched lags, so its null distribution is not centred on zero: picking the
// best of nine correlations inflates it, and the fewer points the window
// holds, the harder it inflates. Measured against independent random series
// (echo-correlation.test.ts pins every row below, 20k trials each):
//
//   window 4 samples (0.75 s)  -> "echo" on 76% of NON-echo episodes
//   window 6 samples (1.25 s)  -> 35%
//   window 8 samples (1.75 s)  -> 15%
//   window 12 samples (2.75 s) -> 2.6%
//   window 20 samples (4.75 s) -> 0.1%
//
// The spans are n-1 ticks, not n: four samples span 750 ms, so the worst row
// here IS the sub-second episode, not something shorter than the table
// reaches. An earlier version of this table rounded each span up one tick and
// hid that.
//
// So a short-window "echo" in the trail is close to no evidence at all, and
// the shadow ledger DECISIONS 076 promotes on must be read stratified by `n`,
// not pooled. MIN_PAIRED_SAMPLES is the floor the brief specified; it is not
// a floor at which the verdict is trustworthy. Raising the floor, or scaling
// the threshold by n and the lag count, is a promotion-time decision with
// field data behind it, not a lab tuning.

export interface LevelSample {
  /** performance.now() milliseconds at the tick that sampled it. */
  atMs: number;
  /** Candidate mic peak 0..1 (the ticker's micPeak). */
  mic: number;
  /** Interviewer remote-analyser peak 0..1 (acoustic level only). */
  remote: number;
}

/** 48 samples = 12 seconds at the room's 250 ms tick. */
export const CORR_RING_CAPACITY = 48;
export const CORR_LAG_MAX_MS = 2000;
export const CORR_ECHO_MIN_R = 0.75;
export const CORR_SPEECH_MAX_R = 0.4;

const CORR_TICK_MS = 250;
const PAIR_TOLERANCE_MS = CORR_TICK_MS / 2;
const MIN_PAIRED_SAMPLES = 4;
/** A floating-point zero floor, NOT an acoustic level. Analyser peaks live in
 * 0..1, so any series carrying real sound clears this by ten orders of
 * magnitude; it exists to keep a flat series out of a division, not to decide
 * what counts as audible. Tuning it against measured levels is a category
 * error. */
const SIGNAL_EPSILON = 1e-12;

export interface EchoCorrVerdict {
  verdict: "echo" | "speech" | "indeterminate";
  /** Peak normalized cross-correlation coefficient, maximised over the lag
   * grid. See the selection-bias table at the top of this file before
   * reading any single value as evidence. */
  r: number;
  /** Lag in milliseconds where the peak was found. */
  lagMs: number;
  /** How much the verdict actually rests on: points paired at the reported
   * lag when a coefficient was computed, otherwise the most the window could
   * offer any lag. Zero means the window held nothing. */
  n: number;
}

export function pushLevelSample(
  ring: LevelSample[],
  sample: LevelSample,
): void {
  ring.push(sample);
  if (ring.length > CORR_RING_CAPACITY) {
    ring.splice(0, ring.length - CORR_RING_CAPACITY);
  }
}

/** Does this series vary at all? The quantity compared is the SUM of squared
 * deviations, which grows with the sample count and is therefore not a
 * variance; nothing here needs one, because the only question asked of it is
 * "is this flat?". Named for the question rather than the quantity so a later
 * reader cannot mistake it for a level measurement.
 *
 * The three flatness guards in this file (mic, remote, and the denominator
 * floor inside pearson) are deliberate defence in depth and are redundant on
 * every input the room can actually produce. Analyser peaks arrive as
 * `|byte - 128| / 128`, so a level series is quantised to 1/128: its squared
 * deviations are either exactly zero or at least about 5e-5, never anywhere
 * near SIGNAL_EPSILON, and an exactly flat series is already caught by the
 * `Number.isFinite` backstop below. The tests that pin the mic and remote
 * guards therefore feed sub-quantisation series; they hold the stated
 * contract in place against a refactor, and are not evidence that either
 * guard fires in the field. */
function hasSignal(values: number[]): boolean {
  if (values.length === 0) return false;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDeviation = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  );
  return squaredDeviation > SIGNAL_EPSILON;
}

function pearson(xs: number[], ys: number[]): number | null {
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let xSquares = 0;
  let ySquares = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index] - xMean;
    const y = ys[index] - yMean;
    numerator += x * y;
    xSquares += x * x;
    ySquares += y * y;
  }
  const denominator = Math.sqrt(xSquares * ySquares);
  if (denominator <= SIGNAL_EPSILON) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function nearestRemote(
  ring: LevelSample[],
  targetAtMs: number,
): LevelSample | null {
  let nearest: LevelSample | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const sample of ring) {
    const distance = Math.abs(sample.atMs - targetAtMs);
    if (distance <= PAIR_TOLERANCE_MS && distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }
  return nearest;
}

const emptyVerdict = (n: number): EchoCorrVerdict => ({
  verdict: "indeterminate",
  r: 0,
  lagMs: 0,
  n,
});

/**
 * Judge one episode window against the ring.
 *
 * Window semantics are inclusive at both ends. An EMPTY window is a supported
 * input, not an edge case: an inverted one (start after end) selects nothing
 * and returns an honest `n=0` indeterminate. Callers with no episode start to
 * offer rely on that instead of branching, so it is contract, not accident,
 * and a test pins it.
 */
export function echoCorrVerdict(
  ring: LevelSample[],
  episodeStartMs: number,
  episodeEndMs: number,
): EchoCorrVerdict {
  const micSamples = ring.filter(
    (sample) => sample.atMs >= episodeStartMs && sample.atMs <= episodeEndMs,
  );
  if (micSamples.length < MIN_PAIRED_SAMPLES) {
    return emptyVerdict(micSamples.length);
  }
  if (!hasSignal(micSamples.map((sample) => sample.mic))) {
    return emptyVerdict(micSamples.length);
  }

  let best: { r: number; lagMs: number; n: number } | null = null;
  let mostPairs = 0;
  let remoteHasVariance = false;
  for (let lagMs = 0; lagMs <= CORR_LAG_MAX_MS; lagMs += CORR_TICK_MS) {
    const mic: number[] = [];
    const remote: number[] = [];
    for (const sample of micSamples) {
      const paired = nearestRemote(ring, sample.atMs - lagMs);
      if (paired !== null) {
        mic.push(sample.mic);
        remote.push(paired.remote);
      }
    }
    mostPairs = Math.max(mostPairs, mic.length);
    // Stricter than the denominator guard inside pearson(), which only needs
    // the PRODUCT of the two squared-deviation sums to clear the floor: a
    // remote series flat to within numerical noise can still ride a loud mic
    // series past that and score r close to 1. A source that never moved
    // cannot have echoed.
    if (hasSignal(remote)) remoteHasVariance = true;
    if (mic.length < MIN_PAIRED_SAMPLES) continue;
    const r = pearson(mic, remote);
    if (r !== null && (best === null || r > best.r)) {
      best = { r, lagMs, n: mic.length };
    }
  }

  if (!remoteHasVariance || best === null) return emptyVerdict(mostPairs);
  const verdict =
    best.r >= CORR_ECHO_MIN_R
      ? "echo"
      : best.r <= CORR_SPEECH_MAX_R
        ? "speech"
        : "indeterminate";
  return { verdict, ...best };
}

export function formatEchoCorrNote(verdict: EchoCorrVerdict): string {
  return `r=${verdict.r.toFixed(2)} lag=${verdict.lagMs}ms n=${verdict.n} ${verdict.verdict}`;
}
