# Rubric corpus (format docs only)

This directory is documentation, not the corpus. It contains exactly two
committed files: this README and one neutral example document. Everything
else that `scorer.rubric.corpus` reads is private.

## Format

- `*.md` -- corpus source documents. Each file becomes one `CorpusDoc`
  (`scorer.rubric.corpus.load_corpus`): `doc_id` is the file stem, the title
  is the first markdown heading (`#`-prefixed, hashes stripped; falls back
  to the stem when no heading exists), and the full file text is the body.
  See `example-public-guide.md` for the shape.
- `fewshot/*.json` -- human-corrected `Rubric` examples, one JSON document
  per file, each validating against `scorer.schemas.Rubric`
  (`scorer.rubric.corpus.load_fewshots`). The rubric compiler feeds up to
  two of them into its prompt as format references.

## Confidentiality (workspace rule R3)

Real corpus content lives ONLY in the private Supabase Storage bucket
`corpus` (local dev override: the directory `SCORER_CORPUS_DIR` points to).
The worker syncs that bucket -- including the `fewshot/` subdirectory -- to
a local cache at runtime; no real corpus document or few-shot rubric is
ever committed to this public repository. The user's application-target JD
list is never committed anywhere, in any form. Eval JDs are representative
public JDs, never the private application list.
