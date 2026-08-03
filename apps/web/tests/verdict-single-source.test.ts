import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadSampleReport } from "@/app/sample-report/sample-data";
import type { DimensionScore, SessionReport, Verdict } from "@/lib/types";
import {
  APPROACHING_OVERALL,
  READY_MIN_DIMENSION,
  READY_OVERALL,
  UNSCORED_READING,
  readVerdict,
  weakestDimension,
} from "@/lib/verdict";
import sampleJson from "@/public/sample-report.json";

// F-21-E. The verdict rule has two clauses and the second one decided the one
// report every visitor can see: the sample scores 4.27 against a 4.0 Ready bar
// and still reads "Approaching", because one dimension is 2.5.
//
// The screen now draws both clauses, which means the web holds a copy of three
// numbers that belong to the worker. tests/pricing-single-source.test.ts is the
// precedent for exactly this shape and this file follows it: the numbers are
// parsed out of the worker's own config and compared, so a threshold changed in
// product.toml fails here instead of silently mislabelling a gauge.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(webRoot, path), "utf8");

/**
 * Source with comments blanked out, line count preserved. The scans below are
 * about what a module emits, not what it explains: these files name the number
 * they refuse to hard-code, and saying "4.27 against a 4.0 bar" in a comment
 * must not be the thing that fails the check for hard-coded bars.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const productToml = readFileSync(
  join(webRoot, "../../services/scorer/config/product.toml"),
  "utf8",
);

/**
 * One float out of a TOML table. Deliberately not a TOML parser: adding a
 * dependency to read three numbers would cost more than it explains, and a
 * miss here fails loudly at the expect() below rather than quietly.
 */
function tomlNumber(table: string, key: string): number {
  const section = productToml.slice(productToml.indexOf(`[${table}]`));
  const next = section.indexOf("\n[", 1);
  const body = next === -1 ? section : section.slice(0, next);
  const match = body.match(new RegExp(`^${key}\\s*=\\s*([0-9.]+)\\s*$`, "m"));
  expect(match, `${key} is missing from [${table}] in product.toml`).not.toBeNull();
  return Number(match![1]);
}

describe("the web's thresholds are the worker's thresholds", () => {
  it("finds the worker's [report] table at all", () => {
    // Guards the regex above: a silently empty parse would make every
    // comparison below pass against NaN.
    expect(productToml).toContain("[report]");
  });

  it.each([
    ["ready_overall", READY_OVERALL],
    ["ready_min_dimension", READY_MIN_DIMENSION],
    ["approaching_overall", APPROACHING_OVERALL],
  ])("%s matches lib/verdict", (key, web) => {
    expect(tomlNumber("report", key)).toBe(web);
  });

  it("keeps the numbers out of the screens that print them", () => {
    // The point of lib/verdict is that a threshold appears once. A component
    // that spells 4.0 into its own markup passes review and then drifts.
    for (const file of [
      "components/ReadinessGauge.tsx",
      "components/ReportView.tsx",
      "app/rubric/page.tsx",
    ]) {
      const code = withoutComments(read(file));
      expect(code, `${file} hard-codes the Ready bar`).not.toContain(
        READY_OVERALL.toFixed(1),
      );
      expect(code, `${file} hard-codes the dimension floor`).not.toContain(
        READY_MIN_DIMENSION.toFixed(1),
      );
    }
  });
});

// --- The predicate -------------------------------------------------------

const DIMENSION_NAMES = [
  { key: "content", name: "Structured thinking" },
  { key: "delivery", name: "Communication Delivery" },
];

function dimension(key: string, score: number): DimensionScore {
  return {
    dimension_key: key,
    score,
    evidence_quotes: [],
    rationale: "",
    strengths: [],
    weaknesses: [],
  };
}

function report(
  verdict: Verdict,
  overall: number,
  scores: [string, number][],
): SessionReport {
  return {
    session_id: "test",
    verdict,
    headline: "",
    eligibility: "scored",
    overall_score: overall,
    dimension_scores: scores.map(([key, score]) => dimension(key, score)),
    delivery_metrics: {
      wpm_overall: 0,
      wpm_timeline: [],
      silence_events: [],
      filler_count: 0,
      filler_rate_per_min: 0,
      f0_variance: null,
      avg_response_latency_s: null,
    },
    delivery_observations: [],
    strengths: [],
    gaps: [],
    next_drills: [],
    limits_note: "",
  };
}

describe("weakestDimension", () => {
  it("returns the lowest score", () => {
    const scores = [dimension("a", 4.4), dimension("b", 2.5), dimension("c", 3.1)];
    expect(weakestDimension(scores)?.dimension_key).toBe("b");
  });

  it("keeps report order on a tie, the way the worker's stable sort does", () => {
    const scores = [dimension("a", 3), dimension("b", 3)];
    expect(weakestDimension(scores)?.dimension_key).toBe("a");
  });

  it("returns null for a report with no dimension scores", () => {
    expect(weakestDimension([])).toBeNull();
  });
});

describe("readVerdict names the clause that decided it", () => {
  it("explains the checked-in sample, which is the whole reason this exists", () => {
    const sample = loadSampleReport(sampleJson);
    const reading = readVerdict(sample.report, sample.dimensions);

    expect(reading.verdict).toBe("approaching");
    expect(reading.clause).toBe("dimension-below-floor");
    expect(reading.weakest?.name).toBe("Communication Delivery");
    expect(reading.weakest?.score).toBe(2.5);
    // A stranger reading the page has to be able to reconstruct the verdict,
    // so the sentence carries all three numbers it turns on.
    expect(reading.sentence).toContain(sample.report.overall_score.toFixed(2));
    expect(reading.sentence).toContain(READY_OVERALL.toFixed(1));
    expect(reading.sentence).toContain(READY_MIN_DIMENSION.toFixed(1));
    expect(reading.sentence).toContain("Communication Delivery");
  });

  it("says both clauses hold on a Ready report", () => {
    const reading = readVerdict(
      report("ready", 4.6, [
        ["content", 4.9],
        ["delivery", 4.1],
      ]),
      DIMENSION_NAMES,
    );
    expect(reading.clause).toBe("both-clear");
  });

  it("names the overall when the dimensions are all fine", () => {
    const reading = readVerdict(
      report("approaching", 3.6, [
        ["content", 3.8],
        ["delivery", 3.2],
      ]),
      DIMENSION_NAMES,
    );
    expect(reading.clause).toBe("overall-below-ready");
  });

  it("names both when neither clears", () => {
    const reading = readVerdict(
      report("approaching", 3.4, [
        ["content", 4.6],
        ["delivery", 2.1],
      ]),
      DIMENSION_NAMES,
    );
    expect(reading.clause).toBe("both-open");
    expect(reading.sentence).toContain("Communication Delivery");
  });

  it("names the Approaching bar when the overall is below it", () => {
    const reading = readVerdict(
      report("not_ready", 2.4, [
        ["content", 2.6],
        ["delivery", 2.1],
      ]),
      DIMENSION_NAMES,
    );
    expect(reading.clause).toBe("below-approaching");
    expect(reading.sentence).toContain(APPROACHING_OVERALL.toFixed(1));
  });

  it("falls back to the dimension key when no rubric rode along", () => {
    const reading = readVerdict(
      report("approaching", 4.2, [
        ["content", 4.9],
        ["delivery", 2.0],
      ]),
      [],
    );
    expect(reading.weakest?.name).toBe("delivery");
  });
});

describe("the worker's verdict wins, always", () => {
  // The predicate explains a verdict; it must never quietly replace one. A
  // scorer that changes its rule without this file changing is exactly the
  // case where a confidently wrong explanation would be worse than none.
  const disagreeing = report("ready", 4.5, [
    ["content", 4.9],
    ["delivery", 1.2],
  ]);

  it("still shows the recorded verdict", () => {
    expect(readVerdict(disagreeing, DIMENSION_NAMES).verdict).toBe("ready");
  });

  it("says the reading could not be reconciled rather than picking a side", () => {
    const reading = readVerdict(disagreeing, DIMENSION_NAMES);
    expect(reading.clause).toBe("unreconciled");
    expect(reading.sentence).toContain("could not be reconciled");
  });

  it("never renders a verdict of its own on any input", () => {
    const cases: [Verdict, number, [string, number][]][] = [
      ["ready", 4.6, [["content", 4.2]]],
      ["approaching", 4.27, [["content", 2.5]]],
      ["not_ready", 1.1, [["content", 1.0]]],
      ["not_ready", 4.9, [["content", 4.9]]],
    ];
    for (const [verdict, overall, scores] of cases) {
      expect(readVerdict(report(verdict, overall, scores)).verdict).toBe(verdict);
    }
  });
});

describe("the unscored reading, which is what /rubric draws", () => {
  it("carries the bars and no values", () => {
    expect(UNSCORED_READING.verdict).toBeNull();
    expect(UNSCORED_READING.overall).toBeNull();
    expect(UNSCORED_READING.weakest).toBeNull();
    expect(UNSCORED_READING.clause).toBe("unscored");
  });

  it("states both bars, because that is the whole point of the screen", () => {
    expect(UNSCORED_READING.sentence).toContain(READY_OVERALL.toFixed(1));
    expect(UNSCORED_READING.sentence).toContain(READY_MIN_DIMENSION.toFixed(1));
  });

  it("is what the rubric page renders", () => {
    const page = read("app/rubric/page.tsx");
    expect(page).toContain("UNSCORED_READING");
    expect(page).toContain("ReadinessGauge");
  });
});

// --- The design system, on the four screens that were held back ----------

describe("the instrument screens are on the design system", () => {
  // These four components and the rubric page were deliberately excluded from
  // the F-21 colour sweep because this track rebuilt them. Same rule, gated
  // here rather than reported once in a hand-run grep.
  const OWNED = [
    "components/ReadinessGauge.tsx",
    "components/ReportView.tsx",
    "components/RubricView.tsx",
    "components/TranscriptView.tsx",
    "app/rubric/page.tsx",
    "lib/verdict.ts",
  ];

  const RAW_COLOUR =
    /\b(?:text|bg|border|divide|ring|from|via|to|placeholder|decoration|fill|stroke|outline)-(?:neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky-\d|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/;

  it.each(OWNED)("%s uses no raw Tailwind colour", (file) => {
    expect(read(file).match(RAW_COLOUR)?.[0] ?? null).toBeNull();
  });

  it.each(OWNED)("%s carries no dark-mode variant", (file) => {
    expect(read(file)).not.toMatch(/\bdark:/);
  });

  it.each(OWNED)("%s contains neither an em-dash nor an en-dash", (file) => {
    expect(read(file)).not.toMatch(/[—–]/);
  });
});

describe("the gauge is one instrument on two screens", () => {
  it("is the same component the report draws and the rubric draws", () => {
    // The superimposition is the claim: a visitor sees the bar on /rubric and
    // then the same bar with a reading on it. Two components that merely look
    // alike would drift apart on the first change to either.
    expect(read("components/ReportView.tsx")).toContain("ReadinessGauge");
    expect(read("app/rubric/page.tsx")).toContain("ReadinessGauge");
  });

  it("draws no filled track and no traffic light", () => {
    const gauge = read("components/ReadinessGauge.tsx");
    // taste-skill 9.F: a filled background track with a partial fill on top is
    // dashboard clutter. The rail is a hairline and the reading is a rule on
    // it. And a low score is never alarm: alarm means a destructive action or
    // a true error, and neither is a candidate scoring 2.5.
    expect(gauge).not.toContain("bg-alarm");
    expect(gauge).not.toContain("text-alarm");
    expect(gauge).toContain("bg-hairline");
  });

  it("says its reading in words for a screen reader", () => {
    // The gauge is a picture of a number, so it owes one accessible name that
    // states the number. The two sentences the old component carried are kept
    // verbatim for the screens that still render one track.
    const gauge = read("components/ReadinessGauge.tsx");
    expect(gauge).toContain('role="img"');
    expect(gauge).toContain("aria-label");
    expect(gauge).toContain("No session has been scored yet.");
    expect(gauge).toContain("Latest overall score ${score.toFixed(1)} out of ${MAX_SCORE}.");
  });
});
