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

  it("never calls loud but uncorrelated barge-in an echo", () => {
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

  it("leaves sub-second episodes indeterminate", () => {
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
