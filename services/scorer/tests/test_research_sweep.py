"""Tests for scorer.research.sweep (cycle 1: query construction)."""
from scorer.research.sweep import build_queries


def test_build_queries_with_company_has_four_in_order():
    queries = build_queries("Senior Product Analyst", "ExampleCorp")
    assert queries == [
        "ExampleCorp Senior Product Analyst interview questions site:glassdoor.com",
        "ExampleCorp Senior Product Analyst interview experience reddit",
        "Senior Product Analyst interview blind teamblind",
        "Senior Product Analyst interview what interviewers look for",
    ]


def test_build_queries_without_company_skips_company_scoped():
    queries = build_queries("Senior Product Analyst", None)
    assert queries == [
        "Senior Product Analyst interview blind teamblind",
        "Senior Product Analyst interview what interviewers look for",
    ]
