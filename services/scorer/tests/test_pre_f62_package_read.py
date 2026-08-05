"""F-62 backward compatibility: pre-F-62 stored packages read unchanged.

Every rubric stored since v0.1 predates jd_evidence, and api/db.py
re-validates the stored JSON through the current Rubric model on every
package read. tests/test_schemas_jd_evidence.py pins the dimension model in
isolation; this file pins the full read path: a stored package whose rubric
JSON has no jd_evidence key anywhere must map to a PackageRow exactly as
today, with every dimension reading back None.
"""
from types import SimpleNamespace

from scorer.api.db import SupabaseDatabase
from scorer.schemas import Rubric


class _StubTable:
    """Minimal PostgREST chain for one canned select (no network)."""

    def __init__(self, rows: list):
        self._rows = rows

    def select(self, columns):
        return self

    def eq(self, column, value):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _StubSupabase:
    def __init__(self, rows: list):
        self._rows = rows

    def table(self, name: str) -> _StubTable:
        return _StubTable(self._rows)


def _pre_f62_dim(key: str, channel: str, weight: float) -> dict:
    """A rubric dimension exactly as stored before F-62: no jd_evidence key."""
    return {
        "key": key,
        "name": key.replace("-", " ").title(),
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": "Vague claims, no example."},
            {"score": 3, "behavior": "One example, thin detail."},
            {"score": 5, "behavior": "Specific and quantified."},
        ],
        "signals": ["named specifics"],
        "citations": [{
            "url": "https://example.com/interview-guide",
            "title": "Example interview guide",
            "snippet": "Interviewers probe for specifics.",
        }],
    }


def _stored_package_row() -> dict:
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "created_at": "2026-07-26T00:00:00+00:00",
        "access_token": "tok_abc",
        "status": "ready",
        "jd_text": "jd text",
        "jd_url": None,
        "candidate_profile": None,
        "rubric": {
            "role_title": "Forward Deployed Product Manager",
            "company": None,
            "dimensions": [
                _pre_f62_dim("structured-answers", "content", 0.5),
                _pre_f62_dim("pacing-control", "delivery", 0.5),
            ],
            "question_bank": [],
            "research_summary": "Stored before jd_evidence existed.",
        },
    }


def test_stored_pre_f62_package_reads_with_every_jd_evidence_none():
    data = _stored_package_row()
    for dim in data["rubric"]["dimensions"]:
        assert "jd_evidence" not in dim   # the exact pre-F-62 stored shape
    row = SupabaseDatabase(_StubSupabase([data])).get_package(data["id"])
    assert row.status == "ready"
    assert isinstance(row.rubric, Rubric)
    assert [d.jd_evidence for d in row.rubric.dimensions] == [None, None]
