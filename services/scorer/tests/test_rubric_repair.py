"""F-96 / DECISIONS 084: the one repair the compiler makes honestly."""

import copy

from scorer.evals_l3.regression import REPO_ROOT
from scorer.rubric.repair import (
    PRODUCT_DELIVERY_CITATION,
    repair_delivery_citations,
)


def _delivery_dim(citations: list | None) -> dict:
    dim = {"key": "spoken-clarity", "channel": "delivery"}
    if citations is not None:
        dim["citations"] = citations
    return dim


class TestTheCitation:
    def test_snippet_is_a_verbatim_substring_of_the_architecture_doc(self):
        doc = (REPO_ROOT / "docs" / "architecture.md").read_text()
        assert PRODUCT_DELIVERY_CITATION["snippet"] in doc
        assert len(PRODUCT_DELIVERY_CITATION["snippet"]) <= 300


class TestTheRepair:
    def test_a_citation_less_delivery_dimension_is_backfilled(self):
        for missing in (None, []):
            raw = {"dimensions": [_delivery_dim(missing)]}
            out = repair_delivery_citations(raw)
            assert out["dimensions"][0]["citations"] == [
                PRODUCT_DELIVERY_CITATION]

    def test_model_provided_delivery_citations_always_win(self):
        provided = [{"url": "https://example.org", "title": "t", "snippet": "s"}]
        raw = {"dimensions": [_delivery_dim(list(provided))]}
        out = repair_delivery_citations(raw)
        assert out["dimensions"][0]["citations"] == provided

    def test_a_content_dimension_is_never_backfilled(self):
        raw = {"dimensions": [{"key": "ownership", "channel": "content",
                               "citations": []}]}
        out = repair_delivery_citations(raw)
        assert out["dimensions"][0]["citations"] == []

    def test_malformed_input_passes_through_untouched(self):
        for garbage in ("text", 7, None, {"dimensions": "nope"},
                        {"dimensions": ["not-a-dict"]}):
            assert repair_delivery_citations(garbage) == garbage

    def test_the_input_is_never_mutated(self):
        raw = {"dimensions": [_delivery_dim([])]}
        frozen = copy.deepcopy(raw)
        repair_delivery_citations(raw)
        assert raw == frozen
