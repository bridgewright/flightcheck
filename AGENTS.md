# Codex Contract

The seven non-negotiables in `CLAUDE.md` bind Codex exactly as they bind every
other agent. `CLAUDE.md` is the single source of truth; do not duplicate or
weaken it here.

## Execution rules

- Work, create files, and commit only in the dedicated task worktree. Treat the
  primary repository checkout and everything outside your worktree as
  read-only. The shared Git directory is writable only to commit to the task
  branch your worktree is on; do not modify any other branch or ref.
- Never run `git push`. Claude reviews, integrates, and pushes accepted work.
- Never print or record `.env` contents or environment-variable values. Never
  commit an `.env` file.
- Keep all code, comments, documentation, and commit messages in English.
- Stay inside the brief. Do not make unrequested refactors or add unrequested
  features. Record discovered issues in the report instead of fixing them.
- Use TDD where applicable and conventional commits.
- Do not report `DONE` unless the gates for every surface you touched pass,
  run from the directory named here. Include concise command evidence in the
  report.

  - `services/scorer`: `cd services/scorer && uv run pytest` and, in the same
    directory, `uv run ruff check .`.
  - `apps/web`: `cd apps/web && npm run gates` — one script running
    `build && test && typecheck && lint` in that order. Build first is not a
    preference: the built-copy gate reads `.next/` and silently goes inert
    without it, passing while verifying nothing. Run the script rather than
    the four commands, so the order cannot be remembered wrongly.
  - A track that touches both runs both.

  The directory is not optional. `uv run` from the repo root finds no project
  environment: `ruff` fails to spawn, and `pytest` binds whatever ambient
  install the machine happens to have — a different version, without any of
  this project's dependencies. That is how a track reports a green it did not
  earn. If the sandbox blocks the default uv cache, copy the existing uv cache
  to a task-specific `/tmp` directory and run the commands offline.
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
