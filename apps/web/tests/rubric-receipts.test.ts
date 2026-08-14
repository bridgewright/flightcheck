import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RubricView from "../components/RubricView";
import { INDIRECT_PROBING_NOTE } from "../lib/rubric-format";
import type { Rubric, RubricDimension } from "../lib/types";

// F-62, the web half: each content dimension on /rubric shows its receipt,
// the JD's own words that license it, and delivery dimensions say in fine
// print that their bar comes from the product instead. RubricView is a
// server component with no render harness (environment: node), so this is a
// source-scan contract in the house style, like verdict-single-source.test.ts.
//
// What it holds: the receipt renders through the design tokens that exist
// for it (LABEL for the heading, EVIDENCE_QUOTE for the reader's JD quoted
// back), the jd_evidence read is defensive because every rubric stored
// before F-62 lacks the field, the delivery line is gated on the whole
// rubric carrying receipts rather than on channel alone (a static line
// keyed on channel would change how pre-F-62 rubrics render), and the
// screen still never leaks the question bank or the ad-hoc company line.

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Source with comments blanked out, line count preserved. The scans below
 * are about what the component emits, not what it explains: the header
 * comment names rubric.question_bank as the thing it refuses to render, and
 * saying so must not be what fails the leak check.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before: string) =>
      before + match.slice(before.length).replace(/./g, " "),
    );
}

const view = read("../components/RubricView.tsx");
const code = withoutComments(view);
const format = read("../lib/rubric-format.ts");

describe("the receipt renders through the tokens that exist for it", () => {
  it("imports EVIDENCE_QUOTE and LABEL from lib/ui", () => {
    const uiImport = view.match(/import \{([^}]+)\} from "@\/lib\/ui";/);
    expect(uiImport, "RubricView no longer imports from lib/ui").not.toBeNull();
    expect(uiImport![1]).toContain("EVIDENCE_QUOTE");
    expect(uiImport![1]).toContain("LABEL");
  });

  it("labels the quote as the reader's own job description", () => {
    // On the comment-blanked source: the label has to be emitted markup, not
    // a sentence in a comment surviving a gutted receipt block.
    expect(code).toContain("From your job description");
  });

  it("quotes the JD back in curly typographic quotes, like ReportView", () => {
    expect(code).toMatch(/&ldquo;\{evidence\}&rdquo;/);
  });
});

describe("absence renders exactly as before F-62", () => {
  it("reads jd_evidence defensively", () => {
    // Every rubric stored before the field existed lacks it; the read must
    // collapse undefined, null, and whitespace to the same no-receipt state.
    expect(code).toContain('dimension.jd_evidence?.trim() ?? ""');
  });

  it("renders the receipt behind the ternary guard", () => {
    expect(code).toMatch(/\) : evidence \? \(/);
  });
});

describe("the delivery line is licensed by the rubric's receipts", () => {
  it("imports the hasReceipts decision from lib/rubric-format", () => {
    expect(code).toMatch(
      /import \{[^}]*\bhasReceipts\b[^}]*\} from "@\/lib\/rubric-format";/,
    );
    expect(code).toContain("hasReceipts(rubric.dimensions)");
  });

  it("never keys on channel alone", () => {
    // A static line keyed on channel would render on every pre-F-62 rubric,
    // which is a compat violation: those must stay byte-identical to today.
    const channelTests =
      code.match(/dimension\.channel === "delivery"/g) ?? [];
    const guarded =
      code.match(/receipts && dimension\.channel === "delivery"/g) ?? [];
    expect(guarded.length).toBeGreaterThan(0);
    expect(
      guarded.length,
      "a delivery-channel test escaped the hasReceipts gate",
    ).toBe(channelTests.length);
  });

  it("renders the product's line in the fine-print register", () => {
    expect(code).toMatch(/<p className=\{FINE_PRINT\}>\{DELIVERY_RECEIPT\}<\/p>/);
  });

  it("keeps the line one string literal in lib/rubric-format", () => {
    // The built-copy gate's lesson: joined copy can be folded apart by the
    // production bundler. One quoted literal has nothing to fold.
    expect(format).toMatch(/export const DELIVERY_RECEIPT =\s*\n?\s*"[^"]+";/);
  });
});

describe("the profile line has its own receipt branch", () => {
  it("renders the profile receipt for profile-licensed dimensions", () => {
    expect(code).toMatch(/dimension\.license === "profile"/);
    expect(code).toMatch(/<p className=\{FINE_PRINT\}>\{PROFILE_RECEIPT\}<\/p>/);
  });

  it("keeps JD quotes and delivery receipts in their existing branches", () => {
    expect(code).toMatch(/&ldquo;\{evidence\}&rdquo;/);
    expect(code).toMatch(/<p className=\{FINE_PRINT\}>\{DELIVERY_RECEIPT\}<\/p>/);
  });
});

describe("the indirect posture is said only where it is true (F-94)", () => {
  // The label is an absolute claim about interviewer behaviour, so where it
  // renders is part of the claim: on an indirect dimension it is honesty, on
  // a direct one it is a lie, and on a legacy rubric it is a compat
  // violation. The value itself collapses absence and "direct" to null
  // (pinned in lib/types-probing-mode.test.ts); these scans hold the
  // component to a single guarded emission of that value.

  it("derives the label through probingLabel", () => {
    expect(code).toMatch(
      /import \{[^}]*\bprobingLabel\b[^}]*\} from "@\/lib\/rubric-format";/,
    );
    // The full binding statement, not just the call: a bare call plus an
    // inline `const probing = "..."` satisfied a call-only scan while
    // rendering the claim on every dimension. Pinning the binding means the
    // guarded value below can only be the helper's return.
    expect(code).toMatch(/const probing = probingLabel\(dimension\);/);
  });

  it("renders the label only behind the guard, on the meta line", () => {
    // The one emission site, in full: guard, separator, value, else nothing.
    expect(code).toMatch(/\{probing \? <> · \{probing\}<\/> : null\}/);
    // And nothing else touches the value. Declaration, guard test, guarded
    // emission: three references. A mutation that renders it unconditionally
    // drops the guard to two, and a second emission site raises it to four,
    // so either direction fails before a reader sees a false claim.
    expect(code.match(/\bprobing\b/g) ?? []).toHaveLength(3);
  });

  it("keeps the copy out of the component", () => {
    // One string literal in lib/rubric-format, per the built-copy lesson.
    // The component reaches it only through probingLabel, so the guard in
    // that helper cannot be bypassed by inlining the sentence here.
    expect(code).not.toContain("INDIRECT_PROBING_NOTE");
    expect(code).not.toContain("Assessed from your answers");
  });

  it("keeps the copy one string literal behind the indirect predicate", () => {
    expect(format).toMatch(
      /export const INDIRECT_PROBING_NOTE =\s*\n?\s*"[^"]+";/,
    );
    expect(format).toMatch(/probing_mode === "indirect"/);
  });
});

describe("what the rendered markup actually says about probing (F-94)", () => {
  // The scans above read the source; this block reads the output. The gap it
  // closes was demonstrated by a survived mutation: a decoy probingLabel call
  // beside `const probing = "Assessed from your " + "answers, ..."` passed
  // every source scan while rendering the absolute claim on every dimension.
  // A rendered-markup assertion cannot be dodged by literal obfuscation,
  // because whatever the source looks like, the reader's string is here.
  // The harness is the house one: coaching-wiring and quick-report already
  // render server components through renderToStaticMarkup.

  const dimension = (over: Partial<RubricDimension>): RubricDimension => ({
    key: "k",
    name: "Dimension",
    weight: 0.2,
    channel: "content",
    anchors: [],
    signals: [],
    citations: [],
    ...over,
  });

  const rubric = (dimensions: RubricDimension[]): Rubric => ({
    role_title: "Role",
    company: null,
    dimensions,
    question_bank: [],
    research_summary: "",
  });

  const markup = renderToStaticMarkup(
    createElement(RubricView, {
      rubric: rubric([
        // Stored before the field existed: absence must say nothing.
        dimension({ key: "legacy", name: "Legacy", channel: "delivery" }),
        // Explicitly direct: also nothing.
        dimension({ key: "direct", name: "Direct", probing_mode: "direct" }),
        // The one indirect dimension: the note, once, on its meta line.
        dimension({
          key: "indirect",
          name: "AI Safety and Mission Alignment",
          probing_mode: "indirect",
        }),
      ]),
    }),
  );

  it("says the note exactly once, for the one indirect dimension", () => {
    expect(markup.split(INDIRECT_PROBING_NOTE)).toHaveLength(2);
  });

  it("places the note on the meta line, after the channel label", () => {
    expect(markup).toContain(`Content: what you say · ${INDIRECT_PROBING_NOTE}`);
  });

  it("ends the direct dimension's meta line at the channel label", () => {
    expect(markup).toContain("Content: what you say</span>");
  });

  it("ends the legacy dimension's meta line at the channel label", () => {
    expect(markup).toContain("Delivery: how you say it</span>");
  });

  it("renders a rubric stored before the field existed with no note at all", () => {
    const legacy = renderToStaticMarkup(
      createElement(RubricView, {
        rubric: rubric([
          dimension({ key: "a", name: "A" }),
          dimension({ key: "b", name: "B", channel: "delivery" }),
        ]),
      }),
    );
    expect(legacy).not.toContain(INDIRECT_PROBING_NOTE);
  });
});

describe("what the screen still never renders", () => {
  it("no question bank, no ad-hoc company line", () => {
    expect(code).not.toContain("question_bank");
    expect(code).not.toContain("rubric.company");
  });
});
