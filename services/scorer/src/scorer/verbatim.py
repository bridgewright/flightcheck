"""Verbatim-span resolution shared by every "quote it exactly" contract.

F-48 introduced the pattern for the judge's key spans; F-62 reuses it for
the rubric's jd_evidence. The contract is always the same: a model claims a
span of some text it was shown, and the product stores only a
character-for-character slice of that text. Consumers locate the span by
exact matching (indexOf on the web, `in` in the scorer), so anything else
is a fabrication and resolves to None.
"""
from __future__ import annotations

import re

# Typographic characters a model flattens to ASCII when it re-types a quote:
# curly quotes, en/em dashes, no-break space. Every mapping is one character
# to one character, so a match found in folded space maps back to the same
# indices in the original haystack -- which is what keeps fold a SALVAGE
# (the stored value is still the haystack's own slice) and not a rewrite.
_TYPOGRAPHIC_FOLD = str.maketrans({
    "\u2018": "'",  # left single curly quote
    "\u2019": "'",  # right single curly quote / apostrophe
    "\u201c": '"',  # left double curly quote
    "\u201d": '"',  # right double curly quote
    "\u2013": "-",  # en dash
    "\u2014": "-",  # em dash
    "\u00a0": " ",  # no-break space
})


def locate_span(haystack: str, span: str | None) -> str | None:
    """The exact substring of `haystack` the claimed span points at.

    An exact match wins. Salvage then runs in order -- a
    whitespace-normalized match, a case-insensitive one, and last a
    typographic fold (curly quotes, dashes, no-break spaces read as their
    ASCII forms) -- and every salvage path resolves back to the exact
    substring as it appears in the haystack: the stored value must be a
    character-for-character slice. The fallbacks exist because real JDs
    carry typographic punctuation and models normalize what they re-type:
    the first real JD through the F-62 contract failed on a capitalized
    quote start, the second on a curly quote flattened to ASCII. Anything
    else resolves to None -- a fabricated quote is worse than none, because
    the product's claim is that its verdicts are honest and arguable.
    """
    if span is None or not span.strip():
        return None
    if span in haystack:
        return span
    pattern = r"\s+".join(re.escape(token) for token in span.split())
    match = re.search(pattern, haystack)
    if match is not None:
        return match.group(0)
    match = re.search(pattern, haystack, re.IGNORECASE)
    if match is not None:
        return match.group(0)
    folded_haystack = haystack.translate(_TYPOGRAPHIC_FOLD)
    folded_span = span.translate(_TYPOGRAPHIC_FOLD)
    pattern = r"\s+".join(re.escape(token) for token in folded_span.split())
    match = re.search(pattern, folded_haystack, re.IGNORECASE)
    if match is not None:
        return haystack[match.start():match.end()]
    return None
