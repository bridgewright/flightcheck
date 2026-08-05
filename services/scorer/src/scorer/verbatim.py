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


def locate_span(haystack: str, span: str | None) -> str | None:
    """The exact substring of `haystack` the claimed span points at.

    An exact match wins. A whitespace-normalized match is accepted ONLY by
    resolving it back to the exact substring as it appears in the haystack:
    the stored value must be a character-for-character slice. Anything else
    resolves to None -- a fabricated quote is worse than none, because the
    product's claim is that its verdicts are honest and arguable.
    """
    if span is None or not span.strip():
        return None
    if span in haystack:
        return span
    pattern = r"\s+".join(re.escape(token) for token in span.split())
    match = re.search(pattern, haystack)
    return match.group(0) if match else None
