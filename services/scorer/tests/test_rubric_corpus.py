"""Tests for scorer.rubric.corpus -- corpus doc loading (cycle 1, no network)."""
from scorer.rubric.corpus import CorpusDoc, load_corpus


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
