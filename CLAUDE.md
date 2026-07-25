# CLAUDE.md — how this repo is built

This product is built AI-natively: Claude Code executes plans task-by-task with TDD; humans set direction, review, and verify. This file is the standing contract for any AI agent working here.

## Non-negotiables

1. **PRD before code.** Product changes update PRD.md before implementation.
2. **Native speech-to-speech only.** No STT→LLM→TTS cascade anywhere — transcription destroys the delivery signal this product sells.
3. **Evals gate releases.** `evals/` suites must pass before any tag. If a gate fails, scope shrinks; the bar does not.
4. **Decisions are logged.** Every non-obvious choice goes to DECISIONS.md with options considered, rejection reasons, and revisit conditions.
5. **English only, MIT, zero confidential content.**
6. **No success claims without run output.** Tests that weren't run didn't pass.
7. **Parallel by default.** Independent work is dispatched to concurrent subagents.

## Working style

TDD (failing test → minimal implementation → pass → commit). Conventional commits. Model IDs and wire-protocol names are isolated in config — providers drift.
