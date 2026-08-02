# Changelog

## [Unreleased]

### Added — accounts, landing, home (v0.4 core)
- Sign-in with Google or a passwordless email link (Supabase Auth). No
  passwords exist anywhere in the product. Interviews now require sign-in;
  a package binds to the first signed-in account that opens it, and a
  package opened by a different account gets an honest 403 page.
- Public landing page: the product explained plainly, a demo-video slot
  (coming soon), and sign-in as the single entry to the app.
- Logged-in home: session journey strip, the next session as a ticket-style
  card with the last verdict and one focus line, the full session list with
  report links, and a readiness dial. The package page becomes the same
  dashboard; the rubric moves into a collapsed disclosure.
- Pricing page and a checkout stub (₩89,000 · one JD · 30 days · 6
  sessions). Payment-provider wiring stays with the payments feature; the
  stub says so honestly.
- Multi-session packages live end to end: a 6-session quota, resume of an
  unfinished session (a connection-guard ending never burns the slot),
  next-index creation, and honest "package exhausted" copy. Two new worker
  routes list a package's sessions and a user's packages.
- Night visual identity across every screen: dark-only palette, serif
  greetings, amber progress lights, coral primary actions — the aviation
  identity lives in the visuals (journey strip, readiness dial, ticket
  structure) while the copy stays plain.

### Added — the client owns all conversational timing
- Silence machinery: with `create_response: false` the server commits turns
  but never speaks on its own — a pure, unit-tested reducer is now the only
  source of `response.create`. Every committed turn arms a debounced
  response (1.2 s); any candidate sound cancels it; sustained quiet walks
  staged `[silence status]` scaffolds at 8 s / 15 s / 30 s (a warm "take
  your time" → one directional hint → an offer to set the question aside),
  each at most once per quiet stretch.
- Filler tolerance: candidate sound shorter than 2 s (um, uh, a cough)
  pauses the silence clock without resetting it — thinking aloud does not
  restart the 8-second count. Interviewer audio also pauses the clock; only
  ≥ 2 s of real speech resets it.
- Reactive silence contract in the interviewer instructions: the model never
  self-initiates "Take your time" — it acts only on injected notes and never
  reads them aloud. If a turn is forced while the candidate's answer is
  clearly unfinished, it degrades to a soft "Mm-hm." and keeps waiting.
- Session-script alignment: interviewer instructions rewritten backwards
  from a co-designed ideal session script — audio-check opening, turn-initial
  backchannels, overlap yield, softened pressure with release, good-luck
  closing.
- Rubric reuse: an identical JD with no personalization inputs copies the
  newest ready rubric instead of recompiling — repeat links are instant and
  cost zero judge-model calls (DECISIONS 010).

### Added — adversarial stability harness
- A seeded adversarial suite now attacks the conversation clock on every
  test run: five generators (VAD flapping, commit storms, dropped/duplicated
  commit flags, echo/barge-in overlap patterns, tick-length spikes) plus a
  5,000-tick mixed soup, all checked against six spec-level invariants by a
  shadow model written independently of the reducer. Every scenario is a
  pure function of its seed, so any failure replays exactly. The five
  2026-08-01 live faults are pinned as named regression scenarios, and the
  wire-event parsers are fuzzed with hostile payloads (malformed frames,
  prototype-pollution shapes, 50 KB strings) and must never throw.
- The generated rounds found two real clock faults before any user did:
  the tick that carried a commit was also credited toward the response
  debounce (shrinking the candidate's room to resume — to zero on a jittery
  tick), and a scaffold and a debounced response could fire on the same
  tick (previously masked by a silent ordering detail in the component).
  Both are fixed in the reducer with named repro tests.
- Writing the seed scenarios exposed a third, pure-layer hole: an echo
  outlasting the 2 s filler threshold restarted the scaffold ladder, so a
  stuck candidate on open speakers would hear "Take your time" every eight
  seconds forever instead of escalating to the directional hint.
  Interviewer audibility now wins on overlapping ticks; a genuine barge-in
  still resets the stretch once the interviewer's audio stops
  (DECISIONS 011 records the related suspension-gap rule).

### Added — session stability guard
- A broken transport now ends the session honestly instead of leaving a
  ghost room where the timer runs and the interviewer never speaks again.
  A pure connection-guard reducer watches four signals every quarter
  second: ICE `failed` (immediate), ICE `disconnected` sustained 8 s, the
  data channel closing mid-session, and starvation — 20 s of expected
  traffic (candidate speaking, interviewer audible, or a response in
  flight) with nothing arriving. Detection is honest by construction: a
  healthy silent room accumulates nothing, so an away-from-keyboard
  candidate is never shown a fake "connection problem", and a
  backgrounded-tab gap resets the guard entirely (the suspension-amnesty
  rule, DECISIONS 011).
- On trip: a plain-language notice ("We hit a connection problem, so this
  session has to end here. It won't count against your package — please
  try again in a few minutes."), graceful teardown, no recording upload,
  and no scoring call — the session row stays `planned`, so the same link
  serves a fresh attempt and the package slot survives. A session where
  the interviewer never answers the opening nudge now ends at ~20 s
  instead of hanging forever.

### Fixed — background-tab resume
- A candidate whose tab was backgrounded (or whose machine slept) no longer
  gets the queued silence scaffolds machine-gunned into their ear on
  refocus: the ticker now measures real elapsed time on a monotonic clock,
  and any gap ≥ 2 s counts as absence rather than silence — the clock
  resets and the interviewer resumes quietly, as a human would after
  glancing up.

### Fixed — open-speakers hardening (five same-evening fixes, instrumented live sessions)
- Silence clock inert and the interviewer mute after the greeting: the
  machinery depended on single transport signals; commit arming and
  interviewer-audibility are now each fed by two independent sources
  (server events plus a WebAudio analyser fallback).
- The interviewer answering its own speaker-leaked echo (self-talking):
  physics-based echo rejection — candidate speech that starts during
  interviewer audio counts as real only if it outlives that audio (an echo
  dies with its source); echo-committed items are deleted from the
  conversation so the model never treats its own words as an answer.
- Phantom turns from ambient room noise: VAD threshold raised to 0.6.
- Broken audio at utterance onset: leaked echo tripped server-side
  interruption, truncating the interviewer's first words —
  `interrupt_response: false`; the audio stream is never chopped, and
  overlap yielding stays an instruction-level behavior.

### Decisions
- DECISIONS 009: `server_vad` + `create_response: false` chosen over
  `semantic_vad` by measured bake-off (semantic_vad never committed complete
  test answers and interrupted an 8 s thinking pause at ~4.4 s).
- DECISIONS 010: rubric reuse for identical JDs.

## [0.2.0] — 2026-08-01

Interviewer UX release, driven by the first full end-to-end session
(2026-07-29 — run by the developer as the product's first user; no external
users yet): the interviewer now opens the call, tolerates thinking pauses,
listens actively, and manages the clock — and the report explains its
scores.

### Added — interviewer UX
- The interviewer speaks first. Instructions alone could not do this —
  server-VAD realtime models never speak unprompted, so the session room now
  nudges the first response at data-channel open (`response.create`), and the
  opening beat is scripted: a hello with an audio check ("can you hear me
  okay?"), one conversational sentence of framing, and a put-at-ease line.
- Thinking-pause tolerance: mid-answer pauses are treated as thinking, not
  end-of-answer — wait, or offer one supportive scaffold; never re-ask the
  same question verbatim, never advance over an unfinished answer. Built for
  non-native speakers, for whom pauses are the norm.
- Active listening: one-sentence restatement of the candidate's key claim
  before follow-ups; evidence probes lead with an acknowledging clause.
- Time awareness: the model has no clock, so the client injects `[time
  status]` system notes at 75% elapsed and at the wrap-up margin; the
  interviewer treats them as its clock and never reads them aloud.
- Session-room copy: "Morgan speaks first — no need to say hello."

### Added — report
- Per-dimension cards now render the judge's written rationale (previously
  computed and stored but never displayed) with verified candidate quotes as
  block quotes under "What you actually said".
- Trimmed-by-default display: the four most load-bearing quotes per dimension
  and the five most significant timeline observations (DSP conflicts always
  surface); the full sets stay one native disclosure away.
- The report page distinguishes a briefly unreachable scoring worker
  (auto-retrying, honest copy) from a genuinely unknown link.

### Changed
- Content judge backs off briefly (1s/2s/4s) on transient 429/transport
  errors instead of failing the run — with a budget separate from the
  one-parse-retry-per-dimension semantics, sized for concurrent sessions.
- Content judge scores dimensions concurrently (bounded thread pool): the
  21 per-dimension judge calls that dominated scoring wall-time now overlap;
  results assemble in rubric order and retry/failure semantics are unchanged.
- Every Gemini API request now carries a hard 8-minute timeout: a stalled
  call fails the session honestly (and "failed" sessions can be re-scored)
  instead of pinning the row in "scoring" forever — observed once in
  production on 2026-07-29.

### Added — operations
- Scoring progress stages: the worker persists which pipeline stage a run is
  in (download → transcribe → delivery-metrics → content-judge →
  delivery-judge → compile) and the report page narrates it while polling.
  Migration: `docs/supabase/migrations/002_scoring_stage.sql`.
- Deploy runbook: first-production-deploy learnings — the Railway builder
  must be Nixpacks (Railpack ignores `nixpacks.toml`), full-length scoring
  needs a Hobby-plan memory ceiling (observed ~1.6 GB peak), `SUPABASE_URL`
  must be the bare project URL, and migrations run in filename order.

### Decisions
- DECISIONS 008: v0.2 ships product depth before payments — versions ship
  one bundle each; the PRD's original metrics stay as written, with the
  timeline shift logged honestly.

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
