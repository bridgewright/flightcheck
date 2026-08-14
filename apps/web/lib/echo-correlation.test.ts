import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CORR_ECHO_MIN_R,
  CORR_LAG_MAX_MS,
  CORR_RING_CAPACITY,
  CORR_SPEECH_MAX_R,
  echoCorrVerdict,
  formatEchoCorrNote,
  pushLevelSample,
  type LevelSample,
} from "./echo-correlation";

const sample = (atMs: number, mic: number, remote: number): LevelSample => ({
  atMs,
  mic,
  remote,
});

/** The room's tick, which every series below is spaced on. The module keeps
 * its own copy private; this one exists so the docblock's published window
 * spans can be checked against the sample counts they claim. */
const TICK_MS = 250;

describe("echoCorrVerdict", () => {
  it("finds a one-bin echo lag in coarse level envelopes", () => {
    const remote = [0.12, 0.7, 0.25, 0.85, 0.38, 0.62, 0.18];
    const ring = remote.map((level, index) =>
      sample(
        index * 250,
        index === 0 ? 0.03 : remote[index - 1] * 0.6 + (index % 2 ? 0.005 : -0.005),
        level,
      ),
    );

    const result = echoCorrVerdict(ring, 250, 1500);

    expect(result.verdict).toBe("echo");
    expect(result.r).toBeGreaterThanOrEqual(CORR_ECHO_MIN_R);
    expect(result.lagMs).toBe(250);
    expect(result.n).toBe(6);
  });

  it("judges an echo tail using remote signal before the episode window", () => {
    const remote = [0.15, 0.8, 0.3, 0.7, 0.2, 0, 0, 0, 0, 0];
    const ring = remote.map((level, index) =>
      sample(index * 250, index < 2 ? 0 : remote[index - 2] * 0.7, level),
    );

    const result = echoCorrVerdict(ring, 500, 1750);

    expect(result.verdict).toBe("echo");
    expect(result.lagMs).toBeGreaterThanOrEqual(500);
    expect(result.n).toBeGreaterThanOrEqual(4);
  });

  it("classifies independent speech with low correlation", () => {
    const mic = [
      0.2, 0.07, 0.78, 0.91, 0.7, 0.12, 0.98, 0.83, 0.51, 0, 0.84, 0.62,
      0.62, 0.02, 0.73, 0.03, 0.48, 0.14, 0.36, 0.89,
    ];
    const remote = [
      0.75, 0.82, 0.3, 0.39, 0.6, 0.03, 0.41, 0.97, 0.75, 0.86, 0.3, 0.69,
      0.79, 0.7, 0.44, 0.17, 0.02, 0.89, 0.93, 0.28,
    ];
    const ring = remote.map((level, index) =>
      sample(index * 250, mic[index], level),
    );

    const result = echoCorrVerdict(ring, 0, 4750);

    expect(result.r).toBeLessThanOrEqual(CORR_SPEECH_MAX_R);
    expect(result.verdict).toBe("speech");
  });

  // "never" would be false as a general claim: over a window this short the
  // measured false-echo rate on independent series is high (see the honesty
  // block below). Scoped to the twenty-tick series it actually feeds.
  it("keeps a loud uncorrelated barge-in under the echo threshold across a twenty-tick window", () => {
    const mic = [
      0.6, 0.54, 0.89, 0.96, 0.85, 0.56, 0.99, 0.92, 0.76, 0.5, 0.92, 0.81,
      0.81, 0.51, 0.87, 0.52, 0.74, 0.57, 0.68, 0.95,
    ];
    const remote = [
      0.88, 0.91, 0.65, 0.7, 0.8, 0.52, 0.71, 0.99, 0.88, 0.93, 0.65, 0.85,
      0.9, 0.85, 0.72, 0.59, 0.51, 0.95, 0.97, 0.64,
    ];
    const ring = remote.map((level, index) =>
      sample(index * 250, mic[index], level),
    );

    expect(echoCorrVerdict(ring, 0, 4750).verdict).not.toBe("echo");
  });

  it("pairs jittered samples to the nearest point within half a tick", () => {
    const times = [0, 240, 510, 740, 1010, 1240, 1510];
    const remote = [0.1, 0.75, 0.25, 0.85, 0.35, 0.65, 0.2];
    const ring = times.map((atMs, index) =>
      sample(atMs, index === 0 ? 0 : remote[index - 1] * 0.6, remote[index]),
    );

    const result = echoCorrVerdict(ring, 230, 1510);

    expect(result.verdict).toBe("echo");
    expect(result.lagMs).toBe(250);
  });

  // Named for what it pins: a window holding three ticks. It does NOT pin
  // "sub-second episodes are indeterminate", which the module does not
  // guarantee and which an earlier name here claimed. The floor counts
  // samples, not milliseconds, and four ticks fit inside 750 ms whenever the
  // episode opens just after one: `echoCorrVerdict(ring, 0, 750)` on a
  // four-tick ring returns a judged verdict, not indeterminate. See the
  // window-length note in the honesty block below.
  it("leaves a three-tick window indeterminate", () => {
    const ring = [sample(0, 0.2, 0.3), sample(250, 0.4, 0.6), sample(500, 0.6, 0.9)];
    expect(echoCorrVerdict(ring, 0, 500)).toMatchObject({
      verdict: "indeterminate",
      n: 3,
    });
  });

  it("guards fewer than four paired points", () => {
    const ring = [sample(0, 0.2, 0.3), sample(250, 0.4, 0.6), sample(500, 0.6, 0.9)];
    expect(echoCorrVerdict(ring, 0, 500).verdict).toBe("indeterminate");
  });

  it("guards zero mic variance", () => {
    const ring = [0, 250, 500, 750].map((atMs, index) =>
      sample(atMs, 0.4, [0.1, 0.8, 0.2, 0.7][index]),
    );
    expect(echoCorrVerdict(ring, 0, 750).verdict).toBe("indeterminate");
  });

  it("guards zero remote variance across every searched lag", () => {
    const ring = Array.from({ length: 12 }, (_, index) =>
      sample(index * 250, index % 2 ? 0.8 : 0.2, 0),
    );
    expect(echoCorrVerdict(ring, 1000, 2750).verdict).toBe("indeterminate");
  });

  it("returns an honest empty verdict when no episode samples exist", () => {
    expect(echoCorrVerdict([], 0, 1000)).toEqual({
      verdict: "indeterminate",
      r: 0,
      lagMs: 0,
      n: 0,
    });
  });

  it("never lets NaN escape", () => {
    const result = echoCorrVerdict(
      [0, 250, 500, 750].map((atMs) => sample(atMs, 0, 0)),
      0,
      750,
    );
    expect(Number.isNaN(result.r)).toBe(false);
    expect(Number.isNaN(result.lagMs)).toBe(false);
  });

  it("searches only the recorded non-negative lag range", () => {
    expect(CORR_LAG_MAX_MS).toBe(2000);
  });
});

// Every construction below is engineered so the coefficient lands EXACTLY on
// a threshold or the pair count lands EXACTLY on a limit. The level values are
// eighths, which are exact in binary, so the means, the deviations and the
// square root of the denominator are all exact and `r` compares equal to the
// constant rather than merely close to it. Loosen any of these to
// approximate values and the boundary stops being pinned.
describe("echoCorrVerdict boundaries", () => {
  it("calls a coefficient exactly at the echo threshold an echo", () => {
    const mic = [0.75, 0.75, 0.25, 0.25, 0.5];
    const remote = [0.875, 0.625, 0.375, 0.375, 0.25];
    const ring = mic.map((level, index) =>
      sample(index * 250, level, remote[index]),
    );

    const result = echoCorrVerdict(ring, 0, 1000);

    expect(result.r).toBe(CORR_ECHO_MIN_R);
    expect(result.verdict).toBe("echo");
    // Peaking at zero also pins the low end of the lag grid: drop lag 0 from
    // the search and the best remaining lag scores 0.64, which is not an echo.
    expect(result.lagMs).toBe(0);
  });

  it("calls a coefficient exactly at the speech threshold speech", () => {
    const mic = [0.75, 0.625, 0.5, 0.375, 0.25];
    const remote = [0.75, 0.25, 0.625, 0.5, 0.375];
    const ring = mic.map((level, index) =>
      sample(index * 250, level, remote[index]),
    );

    const result = echoCorrVerdict(ring, 0, 1000);

    expect(result.r).toBe(CORR_SPEECH_MAX_R);
    expect(result.verdict).toBe("speech");
  });

  it("searches the last lag on the grid, not one short of it", () => {
    // The mic carries the interviewer attenuated and delayed by the full
    // 2000 ms the grid allows, and he falls silent the moment it starts. Only
    // the last lag can see it.
    const lead = [0.2, 0.9, 0.35, 0.75, 0.15, 0.6, 0.45, 0.85];
    const ring: LevelSample[] = [];
    for (let index = 0; index < 8; index += 1) {
      ring.push(sample(index * 250, 0, lead[index]));
    }
    for (let index = 8; index < 16; index += 1) {
      ring.push(sample(index * 250, lead[index - 8] * 0.6, 0));
    }

    const result = echoCorrVerdict(ring, 2000, 3750);

    expect(result.lagMs).toBe(CORR_LAG_MAX_MS);
    expect(result.verdict).toBe("echo");
  });

  it("pairs a sample sitting exactly on the tolerance", () => {
    // At lag 250 the first mic sample looks for a partner at 125 ms, and the
    // only candidate is the ring's opening sample, exactly half a tick away.
    // Refuse that pair and the lag drops to three points, under the floor.
    const times = [0, 375, 625, 875, 1125];
    const remote = [0.2, 0.9, 0.4, 0.8, 0.3];
    const ring = times.map((atMs, index) =>
      sample(atMs, index === 0 ? 0.05 : remote[index - 1] * 0.6, remote[index]),
    );

    const result = echoCorrVerdict(ring, 375, 1125);

    expect(result.verdict).toBe("echo");
    expect(result.lagMs).toBe(250);
    expect(result.n).toBe(4);
  });

  // The two guards below are pinned with series that move far below the
  // analyser's 1/128 quantisation, because that is the only input that tells
  // them apart from the Number.isFinite backstop they sit in front of. They
  // hold the module's stated contract against a refactor; they are NOT
  // evidence that either guard fires on a real session. See the note on
  // hasSignal().
  it("refuses a remote series that is flat to within numerical noise", () => {
    // The mic is loud and the remote moves only in the eighth decimal place.
    // pearson() alone would let this through: its guard is on the PRODUCT of
    // the two squared-deviation sums, which a loud mic carries over the floor
    // on its own, and the coefficient would then read as a perfect echo.
    const mic = [0.75, 0.75, 0.25, 0.25, 0.5];
    const shape = [2, 2, -2, -2, 0];
    const ring = mic.map((level, index) =>
      sample(index * 250, level, 0.5 + shape[index] * 1e-7),
    );

    expect(echoCorrVerdict(ring, 0, 1000).verdict).toBe("indeterminate");
  });

  it("refuses a mic series that is flat to within numerical noise", () => {
    // The mirror: a loud interviewer carries the product over the floor while
    // the candidate's own level never moves, which would otherwise read as a
    // perfect echo of him.
    const remote = [0.875, 0.625, 0.375, 0.375, 0.25];
    const shape = [2, 2, -2, -2, 0];
    const ring = remote.map((level, index) =>
      sample(index * 250, 0.5 + shape[index] * 1e-7, level),
    );

    expect(echoCorrVerdict(ring, 0, 1000).verdict).toBe("indeterminate");
  });

  it("refuses a lag whose paired series are flat only to roundoff", () => {
    // The third guard, pearson()'s denominator floor, which the mic and
    // remote guards above do NOT cover: they test the FULL window series and
    // the per-lag remote, while pearson() sees the PAIRED subset, and pairing
    // can hand it a flat slice of a window that varies. Here the mic is flat
    // from tick 8 and the remote is flat until tick 6, so lag 2000 pairs a
    // flat mic run against a flat remote run while every other lag sees real
    // signal on both sides.
    //
    // The constants are ninths and sevenths: NOT dyadic, so a flat run of
    // them has a mean that carries roundoff and squared deviations near 1e-32
    // rather than the exact zero a dyadic run gives. Delete the denominator
    // floor and that roundoff normalises to r === 1 at lag 2000 -- a perfect
    // echo manufactured from nothing, which `Number.isFinite` cannot catch
    // because 1 is a perfectly finite number.
    //
    // Analyser peaks are dyadic (`|byte - 128| / 128`), so this input is not
    // reachable from today's ticker, and the note on hasSignal() says so.
    // It is pinned because that redundancy is a property of the CALLER, not
    // of this module: any future smoothing, decibel conversion or
    // normalisation of the level makes this guard load-bearing again, and it
    // should fail loudly here rather than quietly promote noise to "echo".
    const flatMic = 5 / 9;
    const flatRemote = 1 / 7;
    const micVary = [0.9, 0.2, 0.7, 0.35, 0.85, 0.15, 0.6, 0.45];
    const remoteVary = [0.3, 0.95, 0.25, 0.8, 0.4, 0.7, 0.55, 0.1];
    const ring = Array.from({ length: 14 }, (_, index) =>
      sample(
        index * 250,
        index < 8 ? micVary[index] : flatMic,
        index < 6 ? flatRemote : remoteVary[index - 6],
      ),
    );

    const result = echoCorrVerdict(ring, 0, 3250);

    expect(result.verdict).not.toBe("echo");
    expect(result.lagMs).not.toBe(CORR_LAG_MAX_MS);
    expect(result.r).toBeLessThan(CORR_ECHO_MIN_R);
  });

  it("reports an empty verdict for an inverted window", () => {
    // The room hands this shape in deliberately when a commit arrives with no
    // speech_started before it. Contract, not accident.
    const ring = Array.from({ length: 12 }, (_, index) =>
      sample(index * 250, 0.2 + index * 0.05, 0.9 - index * 0.05),
    );

    expect(echoCorrVerdict(ring, 1001, 1000)).toEqual({
      verdict: "indeterminate",
      r: 0,
      lagMs: 0,
      n: 0,
    });
  });
});

describe("echoCorrVerdict honesty about what it cannot resolve", () => {
  // Deterministic generator: the numbers in the module docblock and in the
  // promotion decision have to be reproducible, and a seeded sequence is the
  // only way a rate like this can be pinned in a test at all.
  const rng = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  };

  const echoRateOnIndependentSeries = (
    windowSamples: number,
    trials: number,
  ): number => {
    const next = rng(12345);
    // Eight bins of lead so every lag on the grid is searchable, exactly as
    // the room's 12 s ring provides in the field.
    const lead = 8;
    const total = lead + windowSamples;
    let echo = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      const ring: LevelSample[] = [];
      for (let index = 0; index < total; index += 1) {
        ring.push(sample(index * 250, next(), next()));
      }
      const result = echoCorrVerdict(ring, lead * 250, (total - 1) * 250);
      if (result.verdict === "echo") echo += 1;
    }
    return echo / trials;
  };

  it("judges a sub-second window whenever four ticks land inside it", () => {
    // Characterisation, not endorsement. The brief behind this module assumed
    // the four-sample floor made sub-second episodes indeterminate; it does
    // not, because the floor counts ticks and a 750 ms window opening just
    // after a tick holds four of them. A duration floor is a live option for
    // the promotion decision, and if one is added this test is where the
    // change announces itself.
    const remote = [0.2, 0.9, 0.35, 0.75, 0.15];
    const ring = remote.map((level, index) =>
      sample(index * 250, index === 0 ? 0.05 : remote[index - 1] * 0.6, level),
    );

    const result = echoCorrVerdict(ring, 0, 750);

    expect(result.n).toBe(4);
    expect(result.verdict).not.toBe("indeterminate");
  });

  // The rates are READ OUT OF the module docblock rather than restated here.
  // That table is what the promotion decision behind DECISIONS 076 will be
  // read against, and the docblock claims it is pinned; parsing it is what
  // makes the claim true instead of decorative. Restating the numbers in this
  // file would leave the published table free to drift, which is exactly the
  // defect this replaced: the previous assertions were one-sided floors, so
  // the 76% row was pinned only above 60% and a table claiming 3% passed.
  const publishedRows = [
    ...readFileSync(new URL("./echo-correlation.ts", import.meta.url), "utf8")
      .matchAll(
        /window (\d+) samples \(([\d.]+) s\)\s*->\s*(?:"echo" on )?([\d.]+)%/g,
      ),
  ].map(([, samples, spanS, percent]) => ({
    windowSamples: Number(samples),
    spanS: Number(spanS),
    published: Number(percent) / 100,
  }));

  it("publishes a selection-bias table this file can read", () => {
    expect(publishedRows.map((row) => row.windowSamples)).toEqual([
      4, 6, 8, 12, 20,
    ]);
  });

  it.each(publishedRows)(
    "calls independent noise an echo on $published of $windowSamples-sample windows",
    ({ windowSamples, spanS, published }) => {
      // NOT a specification of desired behaviour. This is the selection bias
      // of maximising over nine lags, measured, so that it is on the record
      // before anyone reads the shadow ledger DECISIONS 076 promotes on. Mic
      // and remote here are independent by construction, so every "echo" is
      // false.
      //
      // The span the table prints is n-1 ticks, never n. Getting that wrong
      // is how the four-sample row came to be labelled a one-second window
      // when it is the 750 ms one, which reads as if the table stopped short
      // of the sub-second episodes it actually covers.
      expect(spanS).toBe(((windowSamples - 1) * TICK_MS) / 1000);

      // Ten percent relative, floored so the 0.1% row keeps a usable band.
      // Wide enough to survive a different generator (an independent
      // OS-entropy Monte Carlo at 40k trials/row reads 76.3, 35.2, 14.8, 2.6
      // and 0.09) and far too narrow to survive a wrong table.
      const tolerance = Math.max(published * 0.1, 0.0005);
      const rate = echoRateOnIndependentSeries(windowSamples, 20000);
      expect(rate).toBeGreaterThan(published - tolerance);
      expect(rate).toBeLessThan(published + tolerance);
    },
  );

  it("keeps a leak-carrying barge-in under the echo threshold at three leak levels", () => {
    // The honest open-speaker case, which the uncorrelated barge-in above
    // does not model: the mic carries the candidate's own voice PLUS an
    // attenuated one-bin-delayed copy of the interviewer still playing
    // through the speakers. The margin is thinner than it looks, so the
    // measured coefficient is pinned too: the three leak levels read 0.634,
    // 0.641 and 0.578 against a 0.75 threshold, so the worst case is the
    // MIDDLE one, not the loudest leak. Correlation is not monotonic in leak
    // here because the mic clamps at 1.0, and a clamped series has a flatter
    // shape than the source it is copying.
    const remote = [
      0.62, 0.91, 0.55, 0.78, 0.66, 0.83, 0.59, 0.95, 0.7, 0.6, 0.88, 0.52,
      0.74, 0.97, 0.63, 0.81, 0.57, 0.9, 0.68, 0.76,
    ];
    const own = [
      0.71, 0.58, 0.93, 0.64, 0.86, 0.55, 0.79, 0.68, 0.97, 0.6, 0.75, 0.89,
      0.53, 0.82, 0.7, 0.94, 0.61, 0.77, 0.85, 0.56,
    ];

    for (const leak of [0.2, 0.35, 0.5]) {
      const ring = remote.map((level, index) =>
        sample(
          index * 250,
          Math.min(1, own[index] + (index === 0 ? 0 : leak * remote[index - 1])),
          level,
        ),
      );

      const result = echoCorrVerdict(ring, 0, 4750);

      expect(result.verdict).not.toBe("echo");
      expect(result.r).toBeLessThan(CORR_ECHO_MIN_R);
      expect(result.r).toBeGreaterThan(0.5);
    }
  });
});

describe("formatEchoCorrNote", () => {
  it("rounds the coefficient only in the trail note", () => {
    expect(
      formatEchoCorrNote({ verdict: "echo", r: 0.8249, lagMs: 250, n: 9 }),
    ).toBe("r=0.82 lag=250ms n=9 echo");
  });
});

describe("pushLevelSample", () => {
  it("mutates the same ring and trims it to twelve seconds", () => {
    const ring: LevelSample[] = [];
    const identity = ring;
    for (let index = 0; index <= CORR_RING_CAPACITY; index += 1) {
      pushLevelSample(ring, sample(index * 250, 0, 0));
    }

    expect(ring).toBe(identity);
    expect(ring).toHaveLength(CORR_RING_CAPACITY);
    expect(ring[0].atMs).toBe(250);
  });
});
