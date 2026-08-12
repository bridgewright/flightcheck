import { describe, expect, it } from "vitest";

import { cookedRules } from "./cooked-rules";
import { cookedStrings } from "./cooked";

// The corpus is the contract (DECISIONS 066). Every entry is a spelling of a
// forbidden token that walked a line-by-line scan, plus the obvious neighbours
// of the two this repo has actually seen: `String.fromCharCode(8212)` to dodge
// the em-dash scan, and `` `${FIELD} bg-red-` + "500" `` to dodge the palette
// scan. A new evasion found in review is added here FIRST, so the gate's own
// coverage is gated.
//
// The rules come from cooked-rules.ts, the same list the tree-wide pass in
// token-vocabulary.test.ts runs. A corpus that carried its own copy would prove
// only that the extractor works: the rules could be weakened on the side that
// scans the product and this file would never notice.

function caught(source: string): boolean {
  const rules = cookedRules({ colour: false, dash: false });
  return cookedStrings(source).some(({ value }) => rules.some((rule) => rule.test(value)));
}

const POSITIVES: [source: string, why: string][] = [
  ['const c = "bg-red-" + "500";', "literal concatenation"],
  ['const c = `${FIELD} bg-red-` + "500";', "template fragment and concatenation"],
  ['const c = `bg-red-${""}500`;', "constant template interpolation"],
  ['const s = "before \\u2014 after";', "unicode-escaped dash"],
  ["const s = String.fromCharCode(8212);", "character code"],
  ['const s = String["fromCharCode"](8212);', "character code, member name hidden in a string"],
  ['const c = "dark" + ":" + "bg-black";', "dark variant and bare colour"],
  ['const h = "#" + "8b5cf6";', "whole hex value"],
  ['const h = shade + "#8b5cf6";', "hex value with an unknown neighbour"],
  ['const h = "#" + "8b5cf" + shade;', "hex value assembled around an unknown tail"],
  ['const c = "bg-[#" + "8b5cf6]";', "arbitrary colour value"],
  ['const c = "color: rgb" + "(0 0 0)";', "colour function"],
  ['const c = "text-[" + "13px]";', "pixel font size"],
  ['const k = "background" + "Image";', "computed background property"],
  ['const css = "background" + "-image: url(x)";', "background image inside a style string"],
  ['const g = "bg-linear" + "-to-r";', "gradient utility"],
  ['const g = "bg-[image:linear" + "-gradient(red,blue)]";', "arbitrary gradient value"],
  ['const c = "bg-\\u0072ed-500";', "unicode escape within token"],
  ['const c = "bg-re\\x64-500";', "hex escape within token"],
  ["const v = <p>a &mdash; b</p>;", "named character reference in JSX text"],
  ["const v = <p>a &#8212; b</p>;", "decimal character reference in JSX text"],
  ["const v = <p>a &#x2014; b</p>;", "hex character reference in JSX text"],
  ['const v = <p title="a &ndash; b">x</p>;', "character reference in a JSX attribute"],
  [
    'const v = <p className="bg&#45;red&#45;500">x</p>;',
    "palette token assembled from character references",
  ],
];

const NEGATIVES: [source: string, why: string][] = [
  ['const u = "https://example.test/#deadbe";', "URL anchor"],
  ["const tone = getTone(); const c = `bg-${tone}`;", "unknown interpolation"],
  ['const c = `bg-red${suffix}-500`;', "unknown fragment splitting a token"],
  ['const t = "text-ink/60";', "product token"],
  ['const j = parts.join("-") + "x";', "non-literal junction"],
  // The boundary of the entity decoding above, verified against the production
  // bundle rather than assumed: only JSX text and JSX attribute STRING values
  // are decoded by the compiler. A plain string and an expression container keep
  // the reference verbatim, so `bg&#45;red&#45;500` is a class that matches
  // nothing rather than a raw palette utility, and reporting it would be a
  // false positive.
  ['const c = "bg&#45;red&#45;500";', "character reference in a plain string"],
  [
    "const v = <p className={`bg&#45;red&#45;500`}>x</p>;",
    "character reference inside an expression container",
  ],
  ["const v = <p>a &notarealentity; b</p>;", "unknown named reference"],
];

describe("cooked string scan corpus", () => {
  it.each(POSITIVES)("catches %s (%s)", (source) => {
    expect(caught(source)).toBe(true);
  });

  it.each(NEGATIVES)("passes %s (%s)", (source) => {
    expect(caught(source)).toBe(false);
  });

  it("has a corpus entry for every rule the pass runs", () => {
    // A rule nobody proves is a rule nobody can trust to fire. This is the
    // check that keeps the corpus honest as rules are added to cooked-rules.ts.
    const unproven = cookedRules({ colour: false, dash: false })
      .filter((rule) =>
        !POSITIVES.some(([source]) => cookedStrings(source).some(({ value }) => rule.test(value))),
      )
      .map(String);
    expect(unproven).toEqual([]);
  });

  it("runs eleven rules, and subtracts them for an exempt file", () => {
    // A rule can be weakened by deletion too, and nothing above would see it:
    // the corpus entry that proves one rule usually matches a neighbour as
    // well, so the count is what makes a removal argue for itself. An exempt
    // file loses rules, never its place in the walk.
    expect(cookedRules({ colour: false, dash: false })).toHaveLength(11);
    expect(cookedRules({ colour: true, dash: false })).toHaveLength(5);
    expect(cookedRules({ colour: false, dash: true })).toHaveLength(10);
    expect(cookedRules({ colour: true, dash: true })).toHaveLength(4);
  });

  it("emits one maximal value with the expression's one-based line", () => {
    expect(cookedStrings('\nconst c = ("a" + "b") + `c${"d"}`;')).toEqual([
      { value: "abcd", line: 2 },
    ]);
  });

  it("folds an unknown fragment to a space, never to nothing", () => {
    // Both directions of the placeholder. "" would join `bg-red` to `-500` and
    // report a token the file does not contain; a non-whitespace sentinel would
    // hide `"#" + "8b5cf" + shade` from the whole-value hex rule, which is how
    // this module shipped.
    expect(cookedStrings("const c = `bg-red${suffix}-500`;")[0].value).toBe("bg-red -500");
    expect(cookedStrings('const h = "#" + "8b5cf" + shade;')[0].value).toBe("#8b5cf ");
  });

  it("extracts JSX text and code points without evaluating identifiers", () => {
    expect(
      cookedStrings(
        'const unknown = String.fromCodePoint(code);\nconst face = String.fromCodePoint(0x1f642);\nconst view = <p>Hello reader</p>;',
      ).map(({ value }) => value),
    ).toEqual(["🙂", "Hello reader"]);
  });

  it("fails loudly on source it cannot parse", () => {
    // Error recovery hands back a tree with fewer strings in it, so a silent
    // parse failure reads as a clean file. Both of these lose the string
    // entirely if nobody checks: the second is a plain .ts generic arrow, which
    // a TSX parse misreads as an unclosed JSX element.
    expect(() => cookedStrings("const c = `unterminated")).toThrow(/did not parse/);
    expect(() => cookedStrings("const id = <T>(v: T) => v;\nconst c = \"bg-red-500\";", "a.tsx")).toThrow(
      /did not parse/,
    );
  });

  it("parses a .ts file as TypeScript, not as TSX", () => {
    const source = 'const id = <T>(v: T) => v;\nconst c = "bg-red-500";\n';
    expect(cookedStrings(source, "lib/id.ts").map(({ value }) => value)).toContain("bg-red-500");
  });
});
