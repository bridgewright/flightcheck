# Changelog

## [Unreleased]

### Changed
- Content judge scores dimensions concurrently (bounded thread pool): the
  21 per-dimension judge calls that dominated scoring wall-time now overlap;
  results assemble in rubric order and retry/failure semantics are unchanged.
- Every Gemini API request now carries a hard 8-minute timeout: a stalled
  call fails the session honestly (and "failed" sessions can be re-scored)
  instead of pinning the row in "scoring" forever — observed once in
  production on 2026-07-29.

### Added
- Scoring progress stages: the worker persists which pipeline stage a run is
  in (download → transcribe → delivery-metrics → content-judge →
  delivery-judge → compile) and the report page narrates it while polling.
  Migration: `docs/supabase/migrations/002_scoring_stage.sql`.
- Deploy runbook: first-production-deploy learnings — the Railway builder
  must be Nixpacks (Railpack ignores `nixpacks.toml`), full-length scoring
  needs a Hobby-plan memory ceiling (observed ~1.6 GB peak), `SUPABASE_URL`
  must be the bare project URL, and migrations run in filename order.

## [0.1.0] — 2026-07-26

First public release: the full loop is live — JD intake → per-JD researched rubric →
20-minute browser voice interview → dual-channel scoring → honest session report.

### Pre-release groundwork
- Repo bootstrapped with the PRD committed before any product code (see commit
  history).
- 2026-07-25 — S2S provider bake-off decided (DECISIONS #002): live
  interviewer OpenAI Realtime, scoring channel Gemini 2.5 Flash. Measured, not
  guessed: latency/stability/discrimination suites plus live browser sessions.
  Report: `evals/reports/2026-08-02-provider-bakeoff.md`.
- Browser session lab (webroom) built during the bake-off: ephemeral-token
  auth, WebRTC echo cancellation, tuned turn detection.

### Added
- JD intake (URL or pasted text) with optional resume PDF and LinkedIn
  Save-to-PDF profile inputs (no scraping).
- Per-JD live research sweep (grounded search with citations) feeding a BARS
  rubric compiler; every dimension carries at least one source citation and
  weights sum to 1.0 by validation.
- Baseline 20-minute S2S session in the browser: OpenAI Realtime (`gpt-realtime`)
  interviewer "Morgan" over WebRTC, one pressure probe, 25-minute hard cut,
  local recording uploaded straight to private storage via signed upload URLs.
- Dual-channel scoring on Gemini 2.5 Flash: content judge on the verbatim
  transcript (BARS anchors, quotes verified against the transcript) and delivery
  judge on the actual audio, cross-checked against DSP metrics (WPM timeline,
  fillers, silences >= 1s, response latency) with conflicts flagged.
- Session report with verdict (not_ready / approaching / ready), per-dimension
  evidence, timestamped observations, next drills, and a report-language lint
  that forbids inner-state assertions.
- Web app: landing, intake, rubric preview, session room, report pages, and a
  no-signup sample report (labeled illustrative synthetic data until the
  launch swap for a real anonymized session — deploy runbook section 5.1).
- Deploy: Vercel (`apps/web`) + Railway (`services/scorer` worker, ffmpeg via
  nixpacks) + Supabase (Postgres; private `recordings` and `corpus` buckets).
  Runbook in `docs/deploy.md`.
- `PLAYBOOK.md` (reusable rubric-compilation and raw-audio scoring patterns)
  and `RETRO.md` (honest retros, including the eval-gate iteration below).

### Fixed
- Live Gemini structured-output path: google-genai 2.14.0 forwards
  `additionalProperties` for the scorer's `extra="forbid"` pydantic schemas and
  the Developer API rejects it with 400; a client-seam shim now routes pydantic
  response schemas through `response_json_schema` (found live in release prep —
  the fake-client test gate cannot see it).
- Wrapped genai client lifetime: `genai.Client` closes its shared httpx client
  on garbage collection, killing requests mid-run; `CompatClient` now holds the
  inner client alive (also found live in release prep).
- Content judge discrimination: batched all-dimension scoring saturated the
  responsive dimension at 5.0 and single calls were not reproducible even at
  temperature 0 with a fixed seed; the judge now scores each content dimension
  in a focused call and averages three seeded samples (layer-1 accuracy
  0.0 → 1.0 against the golden triplets), with one retry per dimension on a
  malformed sample so a single bad reply cannot fail a whole session.
- JD URL intake: an unfetchable or bot-walled JD URL now returns a clean 422
  ("paste the JD text instead") surfaced on the intake form, instead of a
  generic 502.
- Background compile task wrapped like the scoring task, so a double fault can
  never crash the worker.

### Security (pre-release hardening from the final whole-branch review)
- Removed a dead browser-reachable route that returned the full package row —
  including the interview question bank — to any token holder; a vitest
  tripwire keeps it dead.
- Package access token is now required on every state-changing web route,
  including session creation.
- Recording storage paths are derived server-side from the authorized session
  row; the client can no longer point scoring at an arbitrary bucket path.
- Recordings upload straight to Supabase Storage via server-minted signed
  upload URLs, so multi-megabyte bodies never transit (or buffer in) a Vercel
  function.
- SSRF guard on the JD URL fetch: http/https only, public-address resolution
  enforced on every redirect hop, response size capped.
- Session create is idempotent (v0.1 is single-session per package) and
  re-scoring an in-flight or scored session returns 409 — closing both a
  recording-overwrite race and an unmetered re-scoring loop.
- Worker bearer auth compares tokens constant-time (`secrets.compare_digest`)
  and returns 401 (not 500) on non-ASCII Authorization headers.
- Web API routes log failures server-side (no tokens, no request bodies)
  before returning generic errors.

### Evals (release gate: `scorer-evals` exit 0)
- 2026-07-26: layer 1 rubric discrimination accuracy 1.0
  (baseline 0.8).
- 2026-07-26: layer 3 delivery discrimination judge accuracy
  1.0 (baseline 0.8); DSP separability recorded, not gated in v0.1.
- Numbers of record committed verbatim in
  `evals/reports/2026-07-26-v01-gate.md` (generated `evals/out/` artifacts are
  gitignored).
