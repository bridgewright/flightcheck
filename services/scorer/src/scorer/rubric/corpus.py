"""Private rubric corpus: markdown source docs and few-shot example rubrics.

Confidential (workspace rule R3): corpus files and few-shot rubrics live in
the private Supabase Storage bucket "corpus" and are synced to a local
directory before use (SCORER_CORPUS_DIR in dev). This module only reads a
local directory; it never touches the network.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict

from scorer.schemas import Rubric


class CorpusDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc_id: str
    title: str
    text: str


def _first_heading(text: str) -> str | None:
    """The text of the first markdown heading line, or None when there is none."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return None


def load_corpus(corpus_dir: Path) -> list[CorpusDoc]:
    """Read every *.md in corpus_dir (sorted by filename) into CorpusDocs.

    doc_id is the file stem; title is the first markdown heading, falling
    back to the stem. A missing directory yields an empty corpus so local
    dev without a synced corpus still runs.
    """
    if not corpus_dir.is_dir():
        return []
    docs: list[CorpusDoc] = []
    for path in sorted(corpus_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        docs.append(
            CorpusDoc(doc_id=path.stem, title=_first_heading(text) or path.stem, text=text)
        )
    return docs


def load_fewshots(fewshot_dir: Path) -> list[Rubric]:
    """Read every *.json in fewshot_dir (sorted by filename) as example Rubrics.

    Returns an empty list when the directory is missing: few-shots are an
    optional quality booster, never a hard dependency.
    """
    if not fewshot_dir.is_dir():
        return []
    return [
        Rubric.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted(fewshot_dir.glob("*.json"))
    ]
