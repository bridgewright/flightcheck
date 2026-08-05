import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
    expect(code).toMatch(/\{evidence \? \(/);
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

describe("what the screen still never renders", () => {
  it("no question bank, no ad-hoc company line", () => {
    expect(code).not.toContain("question_bank");
    expect(code).not.toContain("rubric.company");
  });
});
