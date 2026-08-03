# Codex Contract

The seven non-negotiables in `CLAUDE.md` bind Codex exactly as they bind every
other agent. `CLAUDE.md` is the single source of truth; do not duplicate or
weaken it here.

## Execution rules

- Work, create files, and commit only in the dedicated task worktree. Treat the
  primary repository checkout and everything outside your worktree as
  read-only. The shared Git directory is writable only to commit to the current
  `codex/*` task branch; do not modify any other branch or ref.
- Never run `git push`. Claude reviews, integrates, and pushes accepted work.
- Never print or record `.env` contents or environment-variable values. Never
  commit an `.env` file.
- Keep all code, comments, documentation, and commit messages in English.
- Stay inside the brief. Do not make unrequested refactors or add unrequested
  features. Record discovered issues in the report instead of fixing them.
- Use TDD where applicable and conventional commits.
- Do not report `DONE` unless the complete `uv run pytest` suite and
  `uv run ruff check .` both pass. Include concise command evidence in the
  report. If the sandbox blocks the default uv cache, copy the existing uv
  cache to a task-specific `/tmp` directory and run both commands offline.
- Set the commit author to `Taehyun Kim`. Add this exact trailer to every
  commit:

  `Co-Authored-By: Codex <codex@openai.com>`

## Report contract

Return a Markdown report with exactly these sections:

- `# Status`: exactly one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, or
  `BLOCKED`.
- `# Commits`: commit hashes and titles, or `None`.
- `# Tests`: commands run and concise result summaries.
- `# Notes`: concerns and unresolved items. For `NEEDS_CONTEXT` or `BLOCKED`,
  state exactly what is required.
