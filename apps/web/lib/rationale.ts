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
// marks a short key span itself, is registry card F-48.

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
