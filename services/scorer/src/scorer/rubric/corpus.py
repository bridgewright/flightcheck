"""Private rubric corpus: markdown source docs for rubric grounding.

Confidential (workspace rule R3): corpus files live in the private Supabase
Storage bucket "corpus" and are synced to a local directory before use
(SCORER_CORPUS_DIR in dev). This module only reads a local directory; it
never touches the network.
"""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict


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
