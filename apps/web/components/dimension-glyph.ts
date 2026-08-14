// Dimension pictograms for the trends table, JSX-free so vitest exercises
// the mapping directly (DECISIONS 071).
//
// Dimension names are rubric-compiled per JD, open-ended strings, so glyphs
// cannot be hand-assigned per dimension the way F-43's session-state icons
// were. Instead: a fixed, hand-authored set drawn in F-43's exact register
// (24-unit viewBox, stroke currentColor, width 1.5, aria-hidden, meaning
// carried by the name beside the glyph), chosen by ordered keyword rules
// over the dimension key and name together. An unmatched dimension degrades
// to its channel's glyph, never to a blank or a placeholder: a wrong glyph
// beside a customer's score would be worse than an honest generic one,
// which is also why the choice is deterministic rules rather than a model
// call at compile time.
//
// The rules are ORDERED, and the order is load-bearing: "Communication
// Delivery" must reach the waveform before the speech bubble, and
// "End-to-End Ownership & Ambiguity Navigation" must reach the flag before
// the branching path. First match wins; add new rules with that in mind.
import type { Channel } from "@/lib/types";

export const GLYPH_PATHS = {
  // A waveform: how something is said, the delivery channel's own mark.
  wave: ["M4 10v4", "M8 7.5v9", "M12 5v14", "M16 7.5v9", "M20 10v4"],
  // Two figures: stakeholders, collaboration across a table.
  people: [
    "M9 4.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Z",
    "M3 19.5a6 6 0 0 1 12 0",
    "M15.5 5a3.25 3.25 0 0 1 0 6.2",
    "M17.5 14.6a6 6 0 0 1 3.5 4.9",
  ],
  // A speech bubble: what is said, communication on the content channel.
  speech: [
    "M20 13.5a2 2 0 0 1-2 2H9.5L5 19.5V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.5Z",
  ],
  // One figure: the customer or user at the centre of the work.
  person: [
    "M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
    "M5.5 20a6.5 6.5 0 0 1 13 0",
  ],
  // A compass: strategy, judgment, knowing which way to point.
  compass: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    "m15.5 8.5-2 5-5 2 2-5 5-2Z",
  ],
  // A chip: technical fluency, the machine under the product.
  chip: [
    "M7.5 7.5h9v9h-9v-9Z",
    "M10 7.5v-3",
    "M14 7.5v-3",
    "M10 19.5v-3",
    "M14 19.5v-3",
    "M7.5 10h-3",
    "M7.5 14h-3",
    "M19.5 10h-3",
    "M19.5 14h-3",
  ],
  // Scales: evaluation, weighing what a system should and should not do.
  scales: [
    "M12 4.5v15",
    "M5.5 7h13",
    "M5.5 7l-2 5a2.7 2.7 0 0 0 4 0l-2-5Z",
    "M18.5 7l-2 5a2.7 2.7 0 0 0 4 0l-2-5Z",
    "M9.5 19.5h5",
  ],
  // A flag: ownership, planted and held to the end.
  flag: ["M6.5 20.5v-16", "M6.5 5h10.5l-2.5 3.5 2.5 3.5H6.5"],
  // A branching path: ambiguity, choosing a direction and moving.
  fork: [
    "M12 20v-7",
    "M12 13c0-3.5-2.5-6-6-6",
    "M8.5 4.5 6 7l2.5 2.5",
    "M12 13c0-3.5 2.5-6 6-6",
    "M15.5 4.5 18 7l-2.5 2.5",
  ],
  // A document: the content channel's generic mark, the honest fallback.
  notes: ["M7 3.5h7l4 4v13H7v-17Z", "M14 3.5V8h4", "M10 13h4.5", "M10 16.5h4.5"],
} as const;

export type GlyphName = keyof typeof GLYPH_PATHS;

// First match wins. Patterns run over "key name" lowercased, so either side
// may carry the keyword. Delivery words come first (so "Communication
// Delivery" is a waveform, not a bubble), people-shaped content words before
// the generic communication rule, and ownership before ambiguity (so
// "Ownership & Ambiguity Navigation" keeps the flag).
//
// Most keywords are stems on purpose, because a compiled rubric inflects
// them freely ("collaboration", "collaborative"). Three are anchored to whole
// words instead, because as bare fragments they reached names they do not
// mean and, first match winning, reached them before the rule written for
// those names: "model" put the microchip beside "Role Modeling", "drive" put
// the ownership flag beside "Data-Driven Decision Making", and "action" put
// the ambiguity fork beside "Abstraction & Systems Thinking". A wrong glyph
// is worse than the channel fallback, so each of those now degrades honestly.
const RULES: { pattern: RegExp; glyph: GlyphName }[] = [
  { pattern: /deliver|spoken|speech|clarity|composure|pacing|pronunciation|accent/, glyph: "wave" },
  { pattern: /stakeholder|collabor|cross.functional|influence/, glyph: "people" },
  { pattern: /communicat|present|storytell|articulat/, glyph: "speech" },
  { pattern: /customer|client|user|empath/, glyph: "person" },
  { pattern: /strateg|judgment|judgement|prioriti|vision|roadmap/, glyph: "compass" },
  { pattern: /technic|implement|engineer|coding|fluen|architect|\bmodels?\b/, glyph: "chip" },
  { pattern: /evaluat|responsib|safety|ethic|metric|measur|quality/, glyph: "scales" },
  { pattern: /owner|impact|end.to.end|accountab|initiative|\bdriv(?:e|es|ing)\b/, glyph: "flag" },
  { pattern: /ambigu|\baction\b|navigat|uncertain|adapt/, glyph: "fork" },
];

/** The glyph each channel degrades to when no keyword lands. A dimension
 * with no channel (the rubric fetch failed) reads as content: most
 * dimensions are, and the document glyph claims nothing it cannot keep. */
export const CHANNEL_GLYPHS: Record<Channel, GlyphName> = {
  content: "notes",
  delivery: "wave",
};

export interface ChosenGlyph {
  glyph: GlyphName;
  /** True when no keyword landed and the channel glyph stood in. */
  fallback: boolean;
}

/** Deterministic keyword-to-glyph choice over the dimension key and name.
 *
 * The channel gates which rules may land at all: a delivery dimension only
 * ever wears the waveform (every other glyph is a content pictogram, and a
 * chip beside "English Fluency" would be the wrong hand entirely), and a
 * content dimension never takes the delivery mark. A null channel, the
 * failed-rubric-fetch case, keeps the whole table in play. */
export function dimensionGlyph(
  key: string,
  name: string,
  channel: Channel | null,
): ChosenGlyph {
  const haystack = `${key} ${name}`.toLowerCase();
  const rules =
    channel === "delivery"
      ? RULES.filter((rule) => rule.glyph === CHANNEL_GLYPHS.delivery)
      : channel === "content"
        ? RULES.filter((rule) => rule.glyph !== CHANNEL_GLYPHS.delivery)
        : RULES;
  for (const rule of rules) {
    if (rule.pattern.test(haystack)) {
      return { glyph: rule.glyph, fallback: false };
    }
  }
  return { glyph: CHANNEL_GLYPHS[channel ?? "content"], fallback: true };
}
