# CLAUDE.md — how this repo is built

This product is built AI-natively. A human sets direction, writes the track briefs, and owns every merge; AI agents write the code and perform the first-pass review. The agents are Claude Code sessions and the Codex CLI, chosen per track (DECISIONS 024, which superseded 007). This file is the standing contract for any AI agent working here; `AGENTS.md` is the Codex-specific addendum and does not weaken anything below.

## Non-negotiables

1. **PRD before code.** `PRD.md` was this repo's first commit, six minutes ahead of the first source file (`328dc15` → `7ea177b`, 2026-07-25), and a product change lands in `PRD.md` no later than the release that ships it. Stated at the granularity actually practised: in v0.5 the rule held only at that granularity — the $49 model shipped in code 65 minutes before the PRD was restated (`6308211` 14:48 → `aa282c2` 15:53, 2026-08-03). Recorded in RETRO.md.
2. **Native speech-to-speech only.** No STT→LLM→TTS cascade in the interview loop or the delivery channel — transcription destroys the delivery signal this product sells. Content is judged from a transcript made after the session; delivery is judged from the raw audio, never from text.
3. **Evals gate releases.** `evals/` suites must pass before any tag (`uv run scorer-evals`, exit 0). If a gate fails, scope shrinks; the bar does not.
4. **Decisions are logged.** Every non-obvious choice goes to DECISIONS.md with options considered, rejection reasons, and revisit conditions.
5. **English only, MIT, zero confidential content.**
6. **No success claims without run output.** Tests that weren't run didn't pass.
7. **Parallel by default, and file ownership never overlaps.** Independent work runs as concurrent agents, each in its own git worktree and branch with an exclusive owned-file list. Anything shared changes once, before the parallel work starts.

## How a release is actually built

Four phases. The shape matters more than the tooling.

1. **Foundations — sequential, on `main`.** Every file that more than one track will touch changes exactly once, up front: schemas, shared client functions, typed errors, pricing constants. Nothing parallel touches them afterwards. This is what makes non-negotiable 7 enforceable instead of aspirational.
2. **Implementation — parallel tracks.** One agent per track, each in its own git worktree and branch, holding an explicit owned-file list and nothing outside it. TDD. Tracks never push and never merge.
3. **Review — one adversarial reviewer agent per track, with fix authority.** It reads the track's diff against the brief that produced it, confirms or discards each suspicion, fixes what it confirms, and hands the integrator a named list of what it could not. This is the first-pass review; the human reads after it, not instead of it.
4. **Integration — the human controller, alone.** Tracks are cherry-picked onto `main` in a fixed order, then the **full gate suite re-runs on the merged tree** (`apps/web`: test, typecheck, lint, build · `services/scorer`: `make test`, `make lint`, both from the repo root). Per-track green is not combined green.

## What the commit log proves, and what it doesn't

`Co-Authored-By` trailers are on every commit through 2026-07-29 and on a minority of the commits after it. The trailer convention was dropped during the heaviest batches; the delegation was not. Read the trailers as a **floor** on AI involvement, not a measure of it: the parallel-track batches described above sit almost entirely in the thin stretch, so the machine-verifiable trail is weakest exactly where the most work happened. Count for yourself:

```bash
git log --format='%(trailers:key=Co-Authored-By,valueonly)' | grep -c .
```

Every commit also carries a single human author. That is integration normalizing authorship, not evidence of solo work: the delegated CLI executor set the wrong commit identity four separate times, corrected at cherry-pick each time.

## Working style

TDD (failing test → minimal implementation → pass → commit). Conventional commits. Model IDs and wire-protocol names are isolated in config (`services/scorer/config/product.toml`) — providers drift.

---

*Restated 2026-08-03 for v0.5.0. The previous version was written on 2026-07-25 and went 292 commits without an update, by which point it described a materially simpler process than the one shipping the releases: no worktrees, no owned-file boundaries, no reviewer agent, and the wrong executor. The v0.5 release audit found the gap; it is corrected here in the open rather than quietly.*
