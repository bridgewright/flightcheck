# Changelog

## [Unreleased]
- Repo bootstrapped: PRD committed before code (see commit history).
- S2S provider bake-off report: `evals/reports/2026-08-02-provider-bakeoff.md`.

### 2026-07-25 — Provider bake-off decided (DECISIONS #002)
- Live interviewer: OpenAI Realtime. Scoring channel: Gemini 2.5 Flash. Measured, not guessed: latency/stability/discrimination suites + live browser sessions. Report: evals/reports/2026-08-02-provider-bakeoff.md
- Browser session room (webroom) shipped: ephemeral-token auth, WebRTC echo cancellation, tuned turn detection

## [0.1.0] — 2026-07-26

First public release: the full loop is live — JD intake → per-JD researched rubric →
20-minute browser voice interview → dual-channel scoring → honest session report.

### Added
- JD intake (URL or pasted text) with optional resume PDF and LinkedIn
  Save-to-PDF profile inputs (no scraping).
- Per-JD live research sweep (grounded search with citations) feeding a BARS
  rubric compiler; every dimension carries at least one source citation and
  weights sum to 1.0 by validation.
- Baseline 20-minute S2S session in the browser: OpenAI Realtime (`gpt-realtime`)
  interviewer "Morgan" over WebRTC, one pressure probe, 25-minute hard cut,
  local recording uploaded to private storage.
- Dual-channel scoring on Gemini 2.5 Flash: content judge on the verbatim
  transcript (BARS anchors, quotes verified against the transcript) and delivery
  judge on the actual audio, cross-checked against DSP metrics (WPM timeline,
  fillers, silences >= 1s, response latency) with conflicts flagged.
- Session report with verdict (not_ready / approaching / ready), per-dimension
  evidence, timestamped observations, next drills, and a report-language lint
  that forbids inner-state assertions.
- Web app: landing, intake, rubric preview, session room, report pages, and a
  no-signup sample report (real anonymized session).
- Deploy: Vercel (`apps/web`) + Railway (`services/scorer` worker, ffmpeg via
  nixpacks) + Supabase (Postgres; private `recordings` and `corpus` buckets).
  Runbook in `docs/deploy.md`.

### Fixed
- Live Gemini structured-output path: google-genai 2.14.0 forwards
  `additionalProperties` for the scorer's `extra="forbid"` pydantic schemas and
  the Developer API rejects it with 400; a client-seam shim now routes pydantic
  response schemas through `response_json_schema` (found live in release prep —
  the fake-client test gate cannot see it).
- Content judge discrimination: batched all-dimension scoring saturated the
  responsive dimension at 5.0 and single calls were not reproducible even at
  temperature 0 with a fixed seed; the judge now scores each content dimension
  in a focused call and averages three seeded samples (layer-1 accuracy
  0.0 → 1.0 against the golden triplets).
- Worker bearer auth compares tokens constant-time (`secrets.compare_digest`).

### Evals (release gate: `scorer-evals` exit 0)
- 2026-07-26: layer 1 rubric discrimination accuracy 1.0
  (baseline 0.8).
- 2026-07-26: layer 3 delivery discrimination judge accuracy
  1.0 (baseline 0.8); DSP separability recorded in
  `evals/out/regression.json`, not gated in v0.1.
