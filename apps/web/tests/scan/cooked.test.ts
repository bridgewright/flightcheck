import { describe, expect, it } from "vitest";

import { cookedStrings } from "./cooked";

const PALETTE =
  "neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|" +
  "emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const PROP =
  "text|bg|border|divide|ring|from|via|to|placeholder|decoration|fill|stroke|outline|shadow|accent|caret";
const RULES = [
  new RegExp(`\\b(?:${PROP})-(?:${PALETTE})-\\d{2,3}\\b`),
  new RegExp(`\\b(?:${PROP})-(?:white|black)\\b`),
  /\bdark:/,
  /^\s*#[0-9a-fA-F]{3,8}\s*$/,
  /\[#[0-9a-fA-F]{3,8}\]/,
  /\b(?:rgb|hsl|oklch|oklab)a?\(/,
  /\bbg-(?:gradient|linear|radial|conic)\b/,
  /-\[(?:[a-z-]+:)?(?:repeating-)?(?:linear|radial|conic)-gradient/,
  /^(?:backgroundImage|background-image)$/,
  /[—–]/,
  /\btext-\[\d+(?:\.\d+)?px\]/,
];

function caught(source: string): boolean {
  return cookedStrings(source).some(({ value }) => RULES.some((rule) => rule.test(value)));
}

describe("cooked string scan corpus", () => {
  it.each([
    ['const c = "bg-red-" + "500";', "literal concatenation"],
    ['const c = `${FIELD} bg-red-` + "500";', "template fragment and concatenation"],
    ['const c = `bg-red-${""}500`;', "constant template interpolation"],
    ['const s = "before \\u2014 after";', "unicode-escaped dash"],
    ["const s = String.fromCharCode(8212);", "character code"],
    ['const c = "dark" + ":" + "bg-black";', "dark variant and bare colour"],
    ['const h = "#" + "8b5cf6";', "whole hex value"],
    ['const c = "text-[" + "13px]";', "pixel font size"],
    ['const k = "background" + "Image";', "computed background property"],
    ['const g = "bg-linear" + "-to-r";', "gradient utility"],
    ['const c = "bg-\\u0072ed-500";', "unicode escape within token"],
    ['const c = "bg-re\\x64-500";', "hex escape within token"],
  ])("catches %s (%s)", (source) => {
    expect(caught(source)).toBe(true);
  });

  it.each([
    ['const u = "https://example.test/#deadbe";', "URL anchor"],
    ["const tone = getTone(); const c = `bg-${tone}`;", "unknown interpolation"],
    ['const t = "text-ink/60";', "product token"],
    ['const j = parts.join("-") + "x";', "non-literal junction"],
  ])("passes %s (%s)", (source) => {
    expect(caught(source)).toBe(false);
  });

  it("emits one maximal value with the expression's one-based line", () => {
    expect(cookedStrings('\nconst c = ("a" + "b") + `c${"d"}`;')).toEqual([
      { value: "abcd", line: 2 },
    ]);
  });

  it("extracts JSX text and code points without evaluating identifiers", () => {
    expect(
      cookedStrings(
        'const unknown = String.fromCodePoint(code);\nconst face = String.fromCodePoint(0x1f642);\nconst view = <p>Hello reader</p>;',
      ).map(({ value }) => value),
    ).toEqual(["🙂", "Hello reader"]);
  });
});
