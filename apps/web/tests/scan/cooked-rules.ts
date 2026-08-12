/**
 * The rules the cooked pass runs, in one place.
 *
 * The corpus in cooked.test.ts and the tree-wide pass in
 * token-vocabulary.test.ts read THIS list. They used to hold a copy each, which
 * made "the corpus is the contract" (DECISIONS 066) untrue in the direction
 * that matters: drop `\bdark:` from the tree-wide copy and the corpus, proving
 * its own copy, stays green while 179 files stop being checked for it.
 *
 * `PALETTE` and `PROP` are duplicated from token-vocabulary.test.ts on purpose
 * — the per-line rules there are load-bearing and were not restructured for
 * this — and the two copies are equal by gate, not by luck: that suite asserts
 * it. Same pattern as the VAD triplet.
 */
export const PALETTE =
  "neutral|gray|grey|slate|zinc|stone|red|orange|amber|yellow|lime|green|" +
  "emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
export const PROP =
  "text|bg|border|divide|ring|from|via|to|placeholder|decoration|fill|stroke|outline|shadow|accent|caret";

export interface CookedExemptions {
  /** The satori/PDF exemption: this file may carry a colour literal, and why is in EXEMPT. */
  colour: boolean;
  /** The prose exemption: this file may keep a dash in a string, and why is in DASH_EXEMPT. */
  dash: boolean;
}

/**
 * Every rule reads a FOLDED value, so each one is the cooked twin of a per-line
 * rule in token-vocabulary.test.ts rather than a new house rule. Exemptions are
 * applied per rule, exactly as the per-line pass applies them — a file is never
 * dropped from the walk.
 */
export function cookedRules({ colour, dash }: CookedExemptions): RegExp[] {
  const colourRules = [
    // `sky` needs a digit to count: bg-sky is the product's own token.
    new RegExp(`\\b(?:${PROP})-(?:${PALETTE})-\\d{2,3}\\b`),
    new RegExp(`\\b(?:${PROP})-(?:white|black)\\b`),
    /\bdark:/,
    // The cooked twin of the quoted-hex rule, so it is anchored: a whole value
    // that is a hex. `#` anywhere in a value would fail on the URL fragment in
    // a docs link, which is not a colour.
    /^\s*#[0-9a-fA-F]{3,8}\s*$/,
    /\[#[0-9a-fA-F]{3,8}\]/,
    /\b(?:rgb|hsl|oklch|oklab)a?\(/,
  ];
  return [
    ...(colour ? [] : colourRules),
    /\bbg-(?:gradient|linear|radial|conic)\b/,
    /-\[(?:[a-z-]+:)?(?:repeating-)?(?:linear|radial|conic)-gradient/,
    // The inline route, `style={{ backgroundImage: … }}`, including the
    // computed-property spelling of it. Not anchored, because the per-line twin
    // is not either: a folded `"background-image: url(…)"` in a style string is
    // the same escape, and this pass exists to close the ones the per-line rule
    // cannot see rather than to see less than it does.
    /backgroundImage|background-image/,
    ...(dash ? [] : [/[—–]/]),
    /\btext-\[\d+(?:\.\d+)?px\]/,
  ];
}
