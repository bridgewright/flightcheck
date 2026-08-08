import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CLOSING,
  FAQ,
  HERO,
  HOW_IT_WORKS,
  PRICING,
  PRICING_LINES,
  SIGNED_IN_CTA,
  SESSION_MINUTES,
  TRIAL_MICROCOPY,
} from "@/components/landing/copy";
import { EXPIRY_DAYS, PACKAGE_SESSIONS, PRICE_DISPLAY } from "@/lib/pricing";

// The landing page is what a stranger reads first,
// so its register is a product constraint, not a matter of taste. The
// register below is binding for a reason: the market's loudest players
// sell with celebrity personas, "100% undetectable" cheating framing, fake
// discount timers, and streak mechanics. An honest-verdict product cannot use
// any of that and still mean its verdicts.
//
// These tests make that enforceable rather than aspirational.

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const landingDir = join(webRoot, "components/landing");

const PROSE: string[] = [
  HERO.heading,
  HERO.body,
  HERO.primaryCta,
  HERO.secondaryCta,
  TRIAL_MICROCOPY,
  SIGNED_IN_CTA,
  PRICING.heading,
  PRICING.priceNote,
  PRICING.trialNote,
  PRICING.refundLine,
  PRICING.cta,
  CLOSING.heading,
  CLOSING.body,
  CLOSING.cta,
  ...HOW_IT_WORKS.flatMap((step) => [step.title, step.detail]),
  ...PRICING_LINES.flatMap((line) => [line.label, line.detail]),
  ...FAQ.flatMap((entry) => [entry.question, entry.answer]),
];

// Words that would each, on their own, undo the product's central claim.
const FORBIDDEN = [
  // cheating-adjacent framing (Final Round, LockedIn)
  "undetectable",
  "invisible",
  "cheat",
  "copilot",
  "beat the interview",
  // hype and false certainty
  "guaranteed",
  "guarantee",
  "revolutionary",
  "game-chang",
  "10x",
  "unlock your potential",
  "dream job",
  // scarcity and gamification (the dossier's AVOID list)
  "limited time",
  "act now",
  "hurry",
  "streak",
  "leaderboard",
  // promises this repo has been burned by before
  "coming soon",
  // borrowed credibility. flightcheck has no external users at all, so a
  // sentence in this class would not be an exaggeration, it would be an
  // invention. A product whose whole claim is that its verdicts are never
  // softened to please anyone cannot manufacture a crowd to be pleased.
  "trusted by",
  "users report",
  "testimonial",
];

const ALLOWED_CAPABILITY_CLAIMS = [
  {
    needle: "fresh topic",
    why:
      "allowed because the planner varies questions by session index and stored " +
      "history as of DECISIONS 058",
  },
];

// The same risk class, where a plain substring would fire on innocent prose.
// "rated " sits inside "generated", "separated" and "operated"; "join " sits
// inside "rejoin the session". Matching those as substrings would plant a gate
// that eventually fails for the wrong reason, and a gate that cries wolf is one
// the next person deletes instead of fixing. So they are matched as the shape
// of the claim: a count of other people, or a score awarded by them.
//
// The \b sits inside the word alternatives rather than after the whole group:
// a trailing \b would kill the digit branch, because "join 500" has no word
// boundary between its "5" and its "0". The control test below is what caught
// that, which is the reason it exists.
const FORBIDDEN_PATTERNS = [
  /\bjoin\s+(?:\d|(?:thousands|hundreds|millions|other|our)\b)/i,
  /\brated\s+(?:\d|(?:by|highly|best|top)\b)/i,
];

describe("the landing copy register", () => {
  it("never raises its voice", () => {
    // An exclamation mark on a page whose product is an honest verdict reads
    // as sales, and sales is exactly what makes a verdict untrustworthy.
    for (const line of PROSE) {
      expect(line, line).not.toContain("!");
    }
  });

  it("contains no forbidden framing", () => {
    const all = PROSE.join(" ").toLowerCase();
    for (const word of FORBIDDEN) {
      expect(all, `forbidden framing: ${word}`).not.toContain(word);
    }
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(all, `forbidden framing: ${pattern}`).not.toMatch(pattern);
    }
  });

  it("the forbidden lists actually catch what they are aimed at", () => {
    // A gate nobody has seen fail is a gate nobody knows the shape of. These
    // are the sentences the additions above exist to stop, and the innocent
    // words that must survive them.
    const caught = [
      "Trusted by 500 candidates.",
      "Users report a 2x callback rate.",
      "Read the testimonials from our members.",
      "Join 500 candidates already practising.",
      "Rated 4.9 out of 5.",
    ];
    for (const line of caught) {
      const lower = line.toLowerCase();
      const hit =
        FORBIDDEN.some((word) => lower.includes(word)) ||
        FORBIDDEN_PATTERNS.some((pattern) => pattern.test(lower));
      expect(hit, `should be caught: ${line}`).toBe(true);
    }
    const allowed = [
      "The report is generated from your own audio.",
      "Content and delivery are scored separately.",
      "The service is operated by one person.",
      "Rejoin the session if your connection drops.",
    ];
    for (const line of allowed) {
      const lower = line.toLowerCase();
      const hits = [
        ...FORBIDDEN.filter((word) => lower.includes(word)),
        ...FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(lower)),
      ];
      expect(hits, `false positive on: ${line}`).toEqual([]);
    }
  });

  it("uses the product's exact verdict vocabulary", () => {
    const all = PROSE.join(" ");
    for (const verdict of ["Not yet ready", "Approaching", "Ready"]) {
      expect(all).toContain(verdict);
    }
    // Near-misses that would drift from what the report actually prints.
    expect(all).not.toContain("not ready yet");
    expect(all).not.toContain("almost ready");
  });

  it("never promises the question bank the product deliberately seals", () => {
    // DECISIONS 015: /rubric shows dimensions, weights, signals, and anchors
    // and NEVER question_bank — a candidate who rehearses the literal probes
    // gets a verdict about their rehearsal. A landing sentence that sells
    // "the questions" is therefore selling something no paying customer ever
    // receives, which is the worst kind of copy defect: one the buyer only
    // discovers after paying.
    const all = PROSE.join(" ").toLowerCase();
    for (const promise of [
      "the questions behind",
      "adds the questions",
      "see the questions",
      "question bank",
    ]) {
      expect(all, `promises the sealed bank: ${promise}`).not.toContain(promise);
    }
  });

  it("does not claim more evidence than the judges actually attach", () => {
    // content/judge.py drops quotes that do not verify against the
    // transcript, and delivery evidence is timestamps rather than words. An
    // absolute "every judgment is quoted" outruns both.
    const all = PROSE.join(" ").toLowerCase();
    expect(all).not.toContain("every judgment is quoted");
  });

  it("says what the trial is under the CTAs", () => {
    expect(TRIAL_MICROCOPY).toContain("free");
    expect(TRIAL_MICROCOPY.toLowerCase()).toContain("no card");
  });

  it("answers the six questions people ask before paying", () => {
    expect(FAQ).toHaveLength(6);
    const questions = FAQ.map((entry) => entry.question.toLowerCase()).join(" | ");
    for (const topic of ["real interview", "verdict", "recording", "refund"]) {
      expect(questions).toContain(topic);
    }
    const answers = FAQ.map((entry) => entry.answer.toLowerCase()).join(" ");
    // The two questions whose wording varies but whose subject cannot.
    expect(answers).toContain("non-native");
    expect(answers).toContain("echo");
  });
});

describe("the landing numbers", () => {
  it("quotes the price from the pricing module, never a literal", () => {
    const source = readFileSync(join(landingDir, "copy.ts"), "utf8");
    expect(source).toContain("@/lib/pricing");
    // A bare "$49" or a bare session count in the prose would be a policy
    // that can drift away from what checkout actually charges.
    expect(source).not.toContain("$49");
    expect(source).not.toMatch(/\b6 sessions\b/);
    expect(source).not.toMatch(/\b30 days\b/);
  });

  it("renders the numbers the pricing module actually holds", () => {
    const all = PROSE.join(" ");
    expect(all).toContain(PRICE_DISPLAY);
    expect(all).toContain(`${PACKAGE_SESSIONS} sessions`);
    expect(all).toContain(`${EXPIRY_DAYS} days`);
    expect(all).toContain(`${SESSION_MINUTES} minutes`);
  });

  it("takes the session length from the module that owns the session clock", () => {
    const source = readFileSync(join(landingDir, "copy.ts"), "utf8");
    expect(source).toContain("SESSION_BUDGET_S");
    expect(SESSION_MINUTES).toBe(20);
  });
});

describe("the landing components", () => {
  const componentSources = readdirSync(landingDir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => [name, readFileSync(join(landingDir, name), "utf8")] as const);

  it("has components to check", () => {
    expect(componentSources.length).toBeGreaterThan(0);
  });

  it.each(componentSources)("%s keeps its prose out of the markup", (_name, source) => {
    // JSX text nodes, i.e. what a visitor reads. Prose belongs in copy.ts
    // where the register above can reach it; a sentence hidden in markup is a
    // sentence nothing checks.
    const textNodes = [...source.matchAll(/>([^<>{}]+)</g)].map((match) => match[1].trim());
    for (const text of textNodes) {
      expect(text, text).not.toContain("!");
      // Anything with a sentence's worth of words is prose, not a label.
      expect(text.split(/\s+/).filter(Boolean).length, text).toBeLessThan(12);
    }
  });

  it.each(componentSources)("%s styles from the token module", (_name, source) => {
    // The F-21 pass re-points lib/ui.ts to a light-first pastel system with a
    // global scale-up. A raw colour utility here is a screen that will not
    // follow, and finding those by eye after the fact is how design passes
    // turn into rewrites.
    const rawColour = source.match(
      /\b(?:text|bg|border|divide|ring|from|via|to)-(?:neutral|gray|slate|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/,
    );
    expect(rawColour?.[0] ?? null).toBeNull();
    expect(source).not.toMatch(/\bdark:/);
    // Layout-only components (a grid, an ordering wrapper) legitimately need
    // no tokens — the spec keeps structure inline on purpose. Anything that
    // draws a surface does need them.
    if (/\b(?:rounded|shadow|ring|outline)-|\bborder\b/.test(source)) {
      expect(source).toContain("@/lib/ui");
    }
  });
});

describe("capability claims the planner can now keep", () => {
  it.each(ALLOWED_CAPABILITY_CLAIMS)(
    "records why $needle is allowed",
    ({ needle, why }) => {
      expect(PROSE.join(" ").toLowerCase()).toContain(needle);
      expect(why).toContain("session index");
      expect(why).toContain("history");
      expect(why).toContain("DECISIONS 058");
    },
  );
});
