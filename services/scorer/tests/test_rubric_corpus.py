"""Tests for scorer.rubric.corpus -- corpus and few-shot loading (no network)."""
import json

from scorer.rubric.corpus import CorpusDoc, load_corpus, load_fewshots
from scorer.schemas import Rubric


def _dim_dict(key: str, name: str, channel: str, weight: float) -> dict:
    lowered = name.lower()
    return {
        "key": key,
        "name": name,
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": f"Fails to show {lowered}: vague claims, no example."},
            {"score": 3, "behavior": f"Shows some {lowered}: one example, thin detail."},
            {"score": 5, "behavior": f"Consistently shows {lowered}: specific, quantified."},
        ],
        "signals": [f"{name}: named specifics"],
        "citations": [{
            "url": "https://glassdoor.example.com/r1",
            "title": "Interview review",
            "snippet": "asked about metrics",
        }],
    }


def _rubric_dict(role_title: str = "Senior Product Analyst") -> dict:
    return {
        "role_title": role_title,
        "company": "ExampleCorp",
        "dimensions": [
            _dim_dict("structured-answers", "Structured answers", "content", 0.3),
            _dim_dict("quantified-impact", "Quantified impact", "content", 0.25),
            _dim_dict("role-knowledge", "Role knowledge", "content", 0.2),
            _dim_dict("pacing-control", "Pacing control", "delivery", 0.15),
            _dim_dict("composure", "Composure", "delivery", 0.1),
        ],
        "question_bank": [{
            "dimension_key": "structured-answers",
            "question": "Walk me through a dashboard you built end to end.",
            "probes": ["What was your specific role?"],
            "source": "research-sweep",
        }],
        "research_summary": "Synthetic rubric used by corpus loading tests.",
    }


def test_load_corpus_reads_md_sorted_with_stem_doc_id(tmp_path):
    (tmp_path / "b-style-guide.md").write_text(
        "# Answer style guide\nLead with the outcome, then the method.")
    (tmp_path / "a-bars-notes.md").write_text(
        "# BARS writing notes\nAnchors describe observable behavior.")
    (tmp_path / "notes.txt").write_text("not markdown; must be ignored")
    docs = load_corpus(tmp_path)
    assert [d.doc_id for d in docs] == ["a-bars-notes", "b-style-guide"]
    assert all(isinstance(d, CorpusDoc) for d in docs)
    assert docs[0].title == "BARS writing notes"
    assert docs[1].text == "# Answer style guide\nLead with the outcome, then the method."


def test_load_corpus_title_falls_back_to_stem_without_heading(tmp_path):
    (tmp_path / "raw-notes.md").write_text("no heading here, just prose")
    docs = load_corpus(tmp_path)
    assert docs[0].title == "raw-notes"
    assert docs[0].doc_id == "raw-notes"


def test_load_corpus_missing_dir_returns_empty(tmp_path):
    assert load_corpus(tmp_path / "does-not-exist") == []


def test_load_fewshots_reads_json_rubrics_sorted(tmp_path):
    (tmp_path / "02-second.json").write_text(json.dumps(_rubric_dict("Second Example Role")))
    (tmp_path / "01-first.json").write_text(json.dumps(_rubric_dict("First Example Role")))
    fewshots = load_fewshots(tmp_path)
    assert [r.role_title for r in fewshots] == ["First Example Role", "Second Example Role"]
    assert all(isinstance(r, Rubric) for r in fewshots)


def test_load_fewshots_missing_dir_returns_empty(tmp_path):
    assert load_fewshots(tmp_path / "does-not-exist") == []
