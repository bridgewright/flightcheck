# CLAUDE.md — how this repo is built

This product is built AI-natively. A human sets direction, writes the track briefs, and owns every merge; AI agents write the code and perform the first-pass review. The agents are Claude Code sessions and the Codex CLI, chosen per track (DECISIONS 024, which superseded 007). This file is the standing contract for any AI agent working here; `AGENTS.md` is the Codex-specific addendum and does not weaken anything below.

## Non-negotiables

1. **PRD before code.** `PRD.md` states a product change before the code that implements it is committed — before the commit, not by the tag. It was this repo's first commit, six minutes ahead of the first source file (`328dc15` → `7ea177b`, 2026-07-25). The rule has been broken here: in v0.5 the $49 model shipped in code 65 minutes before the PRD was restated (`6308211` 14:48 → `aa282c2` 15:53, 2026-08-03), recorded in RETRO.md. That is a violation of this rule, not a looser reading of it. The bar does not move to fit what happened.
2. **Native speech-to-speech only.** No STT→LLM→TTS cascade in the interview loop or the delivery channel — transcription destroys the delivery signal this product sells. Content is judged from a transcript made after the session; delivery is judged from the raw audio, never from text.
3. **Evals gate releases.** `evals/` suites must pass before any tag (`cd services/scorer && uv run scorer-evals`, exit 0). The console script is declared in that project's `pyproject.toml` and resolves only from that directory; from the repo root it does not exist. If a gate fails, scope shrinks; the bar does not.
4. **Decisions are logged.** Every non-obvious choice goes to DECISIONS.md with options considered, rejection reasons, and revisit conditions.
5. **English only, MIT, zero confidential content.**
6. **No success claims without run output.** Tests that weren't run didn't pass.
7. **Parallel by default, and file ownership never overlaps.** Independent work runs as concurrent agents, each in its own git worktree and branch with an exclusive owned-file list. Anything shared changes once, before the parallel work starts.

## How a release is actually built

Four phases. The shape matters more than the tooling.

1. **Foundations — sequential, on `main`.** Every file that more than one track will touch changes exactly once, up front: schemas, shared client functions, typed errors, pricing constants. Nothing parallel touches them afterwards. This is what makes non-negotiable 7 enforceable instead of aspirational.
2. **Implementation — parallel tracks.** One agent per track, each in its own git worktree and branch, holding an explicit owned-file list and nothing outside it. TDD. Tracks never push and never merge.
3. **Review — adversarial reviewer agents with fix authority, in two rounds.** Round 1: one reviewer per track reads the track's diff against the brief that produced it, confirms or discards each suspicion, fixes what it confirms, and hands the integrator a named list of what it could not. **Round 2 reads the fixed tree**, with different reviewers, under one brief: *the fixes are the suspect.* Both batches behind these two tags ran two rounds, and in both the second round found defects in work the first round had already fixed — a fix is written fast, by the agent that was just proven wrong, under the impression that the problem is now understood. The human reads after both rounds, not instead of them.
4. **Integration — the human controller, alone.** Tracks are cherry-picked onto `main` in a fixed order, then the **full gate suite re-runs on the merged tree**: `cd apps/web && npm run gates`, and from the repo root, `make test` and `make lint` for `services/scorer`. Per-track green is not combined green. **Build before test is load-bearing, not stylistic**, which is why the four web gates are one script (`build && test && typecheck && lint`) rather than four commands in a remembered order — the order was documented backwards here until 2026-08-04 and the failure is silent. `apps/web/tests/built-copy.test.ts` checks that six user-visible sentences survive the production bundler intact — a corruption no source-reading test can see, because the source is correct and the bundle is not. With no `.next/` to read there is nothing to check, and the suite reports that as **skipped** rather than passed — `7 passed | 7 skipped` instead of `14 passed`. It used to print a warning and pass; the warning was never surfaced by the runner, so an inert gate and a satisfied one looked identical.

## What the commit log proves, and what it doesn't

`Co-Authored-By` trailers are on every commit through 2026-07-29 and on a minority of the commits after it. The trailer convention was dropped during the heaviest batches; the delegation was not. Read the trailers as a **floor** on AI involvement, not a measure of it: the parallel-track batches described above sit almost entirely in the thin stretch, so the machine-verifiable trail is weakest exactly where the most work happened. Count for yourself:

```bash
git log --format='%(trailers:key=Co-Authored-By,valueonly)' | grep -c .
```

Every commit also carries a single human author. That is integration normalizing authorship, not evidence of solo work: the delegated CLI executor set the wrong commit identity four separate times, corrected at cherry-pick each time.

## Working style

TDD (failing test → minimal implementation → pass → commit). Conventional commits.

**Provider values are config on the scoring side, and not yet on the web side.** `services/scorer/config/product.toml` holds the scoring models and thresholds. `apps/web` never reads that file: the interviewer model and its VAD parameters are literals in `apps/web/lib/realtime.ts`, so `silence_duration_ms` is written as `900` on both sides with nothing comparing them. Two timings *are* pinned across the boundary — `apps/web/tests/session-timing-ssot.test.ts` reads the TOML and fails if the session budget or hard cut drifts, with a mirror gate on the scorer side. Extending that to the interviewer model and the VAD tail is open work. Treat it as open, not done: providers drift, and here the duplicate is currently equal by luck rather than by gate.

**Colour, type and spacing in `apps/web` come from the design-token module `apps/web/lib/ui.ts`.** Raw Tailwind palette classes, `dark:` variants, hard-coded hex or `rgb()` values, and hand-rolled page widths on `<main>` are rejected by scans that run inside the test suite over every file in `app`, `components` and `lib`. The scan is the rule; the prose is a description of it. That is deliberate — the earlier version of this rule was prose plus a scan covering one directory, and the scanned directory stayed clean while the rest of the product accumulated raw literals. A house rule holds exactly as far as a gate enforces it.

---

*Restated 2026-08-03 for v0.5.0, and again 2026-08-04 for v0.6.0 and v0.7.0. The 2026-07-25 original went 292 commits without an update, by which point it described a materially simpler process than the one shipping the releases: no worktrees, no owned-file boundaries, no reviewer agent, and the wrong executor. The v0.5 release audit found that gap. The release audit for these two tags found the smaller second version of it — a review described as one round when it had been two, a config claim that was false for half the product, and three published commands that do not run from the only directory this file named. Both are corrected in the open rather than quietly.*
