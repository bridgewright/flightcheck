"""Deterministic pre-validation repair (F-96, DECISIONS 084).

The one repair the compiler can make honestly: a delivery-channel
dimension arriving from the model with no citations gains the product's
methodology citation. Delivery dimensions are licensed by the product,
not the JD (schemas.py), so the product's own methodology is their
honest source. A content dimension is NEVER touched here -- its
citations are JD and research grounding, and fabricating one is exactly
what the faithfulness gate exists to catch.
"""

from __future__ import annotations

import copy

# Pinned by test to remain a verbatim substring of docs/architecture.md.
PRODUCT_DELIVERY_CITATION = {
    "url": ("https://github.com/bridgewright/flightcheck/blob/main/"
            "docs/architecture.md"),
    "title": "flightcheck scoring pipeline (docs/architecture.md)",
    "snippet": "delivery judge (actual audio; DSP conflicts flagged)",
}


def repair_delivery_citations(raw: object) -> object:
    """Backfill ONLY a citation-less delivery dimension, before validation.

    Anything that is not the expected shape passes through untouched --
    pydantic owns malformed input, and this function must never hide it.
    The input is never mutated.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("dimensions"), list):
        return raw
    repaired = copy.deepcopy(raw)
    for dim in repaired["dimensions"]:
        if (isinstance(dim, dict)
                and dim.get("channel") == "delivery"
                and not dim.get("citations")):
            dim["citations"] = [dict(PRODUCT_DELIVERY_CITATION)]
    return repaired
