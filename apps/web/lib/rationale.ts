// Splitting a judge's rationale into its lead judgment and the support behind it.
//
// The rationale arrives as one paragraph, around 1600 characters on the sample
// report, and it reads as an undifferentiated block: a reader scanning six
// dimensions has nothing to catch. What they want is the finding, with the
// reasoning available underneath.
//
// The lead sentence is that finding. Verified rather than assumed: all six
// dimensions in public/sample-report.json open with the summary judgment
// ("The candidate clearly demonstrates...", "The candidate's delivery is
// characterized by..."), and the sentences that follow are evidence for it.
//
// This is deliberately POSITIONAL, not semantic. The product does not decide
// which words in a judge's paragraph matter; it follows the paragraph's own
// structure. Emphasising a clause the judge did not mark would change what the
// report appears to assert, and this product's whole claim is that its verdicts
// are honest and arguable. The semantically correct version, where the judge
// marks a short key span itself, is registry card F-48 and lives below in
// emphasiseRationale: when the report carries the judge's own span, the
// emphasis is the judge's; when it does not, the positional rule stands.

/** The rationale, split at the end of its first sentence. */
export interface RationaleParts {
  /** The judge's summary judgment. Never empty. */
  lead: string;
  /** Everything after it, or "" when the rationale is a single sentence. */
  rest: string;
}

// A sentence ends at . ! or ? — optionally followed by a closing quote — when
// the next thing that starts is a capital or an opening quote. The lookahead is
// what keeps "e.g." and a quoted fragment ending in a full stop from splitting.
const SENTENCE_END = /([.!?]["'”’]?)\s+(?=["'“‘]?[A-Z])/;

export function splitRationale(rationale: string): RationaleParts {
  const text = rationale.trim();
  const match = SENTENCE_END.exec(text);
  if (match === null || match.index === undefined) {
    return { lead: text, rest: "" };
  }
  const cut = match.index + match[1].length;
  const lead = text.slice(0, cut).trim();
  const rest = text.slice(cut).trim();
  // A lead that swallowed most of the paragraph is not a lead. Better to show
  // one plain block than to emphasise nearly all of it, which emphasises
  // nothing and costs the reader the contrast the split was for.
  if (rest.length === 0 || lead.length > text.length * 0.75) {
    return { lead: text, rest: "" };
  }
  return { lead, rest };
}

/** Which rule chose the emphasis. Renderers that keep their pre-F-48 plain
 * rendering in the fallback (the PDF and the markdown export) branch on this
 * instead of re-deriving the decision. */
export type RationaleEmphasisSource = "key_span" | "first_sentence";

/** The rationale, split around its emphasis. In the key_span case,
 * `before + span + after` reassembles the trimmed rationale exactly. */
export interface RationaleEmphasis {
  /** Text before the emphasis; "" when the emphasis opens the rationale. */
  before: string;
  /** The emphasised text: the judge's own span, or the lead sentence. */
  span: string;
  /** Text after the emphasis; "" when nothing follows it. */
  after: string;
  source: RationaleEmphasisSource;
}

/**
 * The single emphasis rule, for every renderer of a dimension rationale (F-48).
 *
 * When the judge marked its own finding (`key_span`, contractually a verbatim
 * substring of the rationale), the emphasis is that span, split around its
 * first occurrence. Otherwise, and whenever the contract does not hold, the
 * positional first-sentence rule above applies unchanged.
 *
 * The fallback is deliberate on every bad input: absent, null, empty, and
 * span-not-found all land on splitRationale rather than throwing. The scorer
 * pipeline enforces the substring contract at write time; the web renders
 * reports written by every scorer that ever ran, and a report is not the place
 * to crash over a contract violation the reader cannot act on.
 */
export function emphasiseRationale(
  rationale: string,
  keySpan?: string | null,
): RationaleEmphasis {
  const text = rationale.trim();
  // A judge that padded the span with whitespace still marked the same words.
  const span = keySpan?.trim() ?? "";
  if (span !== "") {
    const at = text.indexOf(span);
    if (at !== -1) {
      return {
        before: text.slice(0, at),
        span,
        after: text.slice(at + span.length),
        source: "key_span",
      };
    }
  }
  const { lead, rest } = splitRationale(text);
  return { before: "", span: lead, after: rest, source: "first_sentence" };
}
