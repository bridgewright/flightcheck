"""The shared verbatim-span resolver, lifted from the content judge for F-62.

The judge's key-span behavior stays pinned by test_content_judge_authored.py;
these tests pin the lifted function directly so both consumers (key spans,
rubric jd_evidence) rest on one tested definition.
"""
from scorer.verbatim import locate_span

HAYSTACK = "Owns the roadmap.  Ships weekly,\nwith a bias for evidence."


def test_exact_substring_returned_unchanged():
    assert locate_span(HAYSTACK, "Ships weekly") == "Ships weekly"


def test_whitespace_variant_resolves_to_the_exact_slice():
    # The claim flattens the haystack's whitespace; the resolver must return
    # the character-for-character slice as the haystack actually has it.
    located = locate_span(HAYSTACK, "Ships weekly, with a bias")
    assert located == "Ships weekly,\nwith a bias"
    assert located in HAYSTACK


def test_fabricated_span_resolves_to_none():
    assert locate_span(HAYSTACK, "Ships daily") is None


def test_none_and_blank_resolve_to_none():
    assert locate_span(HAYSTACK, None) is None
    assert locate_span(HAYSTACK, "   ") is None


def test_regex_metacharacters_in_the_claim_stay_literal():
    haystack = "Cut cost by 30% (per quarter) via caching."
    assert locate_span(haystack, "30% (per quarter)") == "30% (per quarter)"


def test_a_capitalized_quote_start_resolves_to_the_exact_slice():
    # The first real JD through the F-62 contract failed on one character:
    # the model quoted a mid-sentence clause and capitalized its first word,
    # as quoting convention teaches. A case-insensitive match is salvage,
    # not fabrication, because what gets stored is still the haystack's own
    # character-for-character slice.
    haystack = "As the services venture, we tackle the hardest problems."
    located = locate_span(haystack, "We tackle the hardest problems.")
    assert located == "we tackle the hardest problems."
    assert located in haystack


def test_exact_case_match_wins_over_a_case_variant_elsewhere():
    # Priority is exact, then whitespace, then case: when the claimed casing
    # exists verbatim, it is returned untouched even if another casing of
    # the same words appears earlier in the haystack.
    haystack = "we ship weekly. Elsewhere: We ship weekly."
    assert locate_span(haystack, "We ship weekly.") == "We ship weekly."
