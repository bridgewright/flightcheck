# DECISIONS.md — architecture decision log

Format per entry: Context · Options · Choice · Why · Rejected because · Revisit when.

## 001 — Native speech-to-speech, cascade rejected (2026-07-25)

**Context:** The product scores interview *delivery* (hesitation, fillers, intonation, pace), not just content.
**Options:** (a) STT→LLM→TTS cascade (e.g., agent platforms), (b) native S2S (GPT Realtime / Gemini Live).
**Choice:** (b), permanently.
**Why:** STT is designed to produce clean text: it deletes fillers, hesitations, and prosody. A cascade therefore *cannot* score delivery — the signal is destroyed before the model sees it. This is a capability boundary, not a quality difference.
**Rejected because:** cascade's maturity/tooling advantages don't compensate for losing the product's core signal.
**Revisit when:** never for the scoring path. (A cascade could only ever serve non-scoring UX surfaces.)

## 002 — S2S provider: GPT Realtime vs Gemini Live (opened 2026-07-25, resolves 2026-08-02)

**Context:** The live interviewer needs one default provider; both sit behind a `RealtimeProbe`-shaped adapter so the choice is reversible.
**Method:** measured bake-off, criteria ordered by lethality: ① 20-min session stability + resumption context retention ② first-response latency (p50/p95) ③ interruption naturalness ④ persona & pressure-instruction adherence ⑤ (scoring channel, chosen independently) audio-understanding discrimination on controlled samples.
**Choice (2026-07-25, eight days early):** **Hybrid — live interviewer: OpenAI Realtime · scoring channel: Gemini.** Full data: `evals/reports/2026-08-02-provider-bakeoff.md`.
**Why:**
- *Interviewer* — OpenAI won both lethality-ranked criteria: 22-min stability 32/32 turns in a single session (Gemini: 27/32 with 2 resumptions in scripted runs, and an unexplained unresponsive session at 4m24s in live browser use), and latency p50 751-843 ms measured / conversational rhythm preserved in live use (Gemini: 1.8 s measured with manual turn signals; 10-20 s perceived turn gaps in browser with automatic VAD — breaks the interview illusion outright).
- *Scorer* — Gemini won decisively: 0.92-1.00 ranking accuracy on controlled delivery triplets vs 0.50 for gpt-audio (chance = 0.17). The scoring path is file-based (non-realtime), so Gemini's live-path weaknesses don't apply to it.
- The two paths were deliberately decoupled in the architecture precisely so each race's winner could be composed.
**Rejected because:** Gemini-as-interviewer had real strengths (more context-aware probing, more human voice, no barge-in at thinking pauses) but they cannot compensate for turn-gap and session-reliability failures on the two highest-lethality criteria. OpenAI-as-scorer rejected on discrimination accuracy.
**Known weaknesses of the choice, with mitigation paths:** OpenAI's checklist-like follow-ups (→ rubric-grounded session plans that force quoting the candidate, v0.1) and barge-in at ~2 s thinking pauses (→ semantic_vad experiment + per-user silence calibration, W2 backlog).
**Revisit when:** OpenAI live session-failure rate exceeds 2%, or Gemini ships a realtime revision materially improving end-of-speech detection latency.

## 003 — LinkedIn: official PDF export, no scraping (2026-07-25)

**Context:** Intake accepts a LinkedIn profile as candidate background.
**Options:** (a) third-party scraping APIs, (b) headless browser with user session, (c) official "Save to PDF" + paste fallback.
**Choice:** (c).
**Why:** (a)/(b) are ToS-hostile, fragile, and — decisive — send a paying customer's personal data to third-party scrapers. (c) is stable, takes the user ~10 seconds, and keeps PII in-house. All intake sources normalize to one candidate-profile schema, so the compiler is source-agnostic.
**Revisit when:** an official partner API becomes accessible.

## 004 — Payments: merchant-of-record first (2026-07-25)

**Context:** Korean solo builder; the product sells globally in USD/KRW from day one.
**Options:** (a) Stripe direct, (b) Korean PG (e.g., Toss Payments), (c) merchant-of-record checkout (Lemon Squeezy or Polar).
**Choice:** (c) for v0.x — the MoR is the seller of record, handles global cards and tax; a webhook provisions packages.
**Rejected because:** (a) Stripe does not onboard KR merchants; (b) domestic PGs require business registration the builder does not yet have, and poorly serve non-Korean cards — half the target market.
**Revisit when:** domestic volume justifies business registration + a Korean PG, or MoR fees exceed ~10% of revenue.

## 005 — Bake-off voice clips stay out of git (2026-07-25)

**Context:** the audio-discrimination probe uses recordings of a real person's voice (controlled fluent/filler/hesitant samples).
**Options:** (a) commit the clips for full reproducibility, (b) commit via Git LFS, (c) git-ignore the audio and commit only derived metrics + the recording protocol.
**Choice:** (c) — clips are git-ignored; only derived metrics, rankings, and the re-recording protocol are committed.
**Why:** a public repo is forever; biometric-adjacent personal data doesn't belong in it. Reproducibility is preserved via the recording protocol doc — anyone can re-record the controlled triplets in ~15 minutes.
**Rejected because:** (a)/(b) both publish a real person's voice permanently; LFS changes storage, not exposure.
**Revisit when:** the project obtains consented, license-cleared sample voices (e.g., synthetic or professionally released), which could then ship as a committed reference set.

## 006 — v0.1 architecture: Next.js web + FastAPI scoring worker + Supabase

- **Decision:** ship v0.1 as three deploy units — `apps/web` (Next.js App
  Router on Vercel: landing, intake, session room, report pages, and the
  server routes that hold secrets), `services/scorer` (the existing Python
  package extended with a FastAPI worker on Railway: intake normalization,
  research sweep, rubric compiler, scoring pipeline), and Supabase (Postgres
  for package/session state; private Storage buckets `recordings` and
  `corpus`).
- **Why:** the scoring stack is irreducibly Python (librosa/soundfile DSP,
  ffmpeg, google-genai file uploads, the already-tested scorer package),
  while the session room needs a first-class browser runtime (WebRTC plus
  ephemeral-secret minting on server routes). Splitting on that seam lets
  each half keep its native toolchain, deploys each unit where it runs best,
  and keeps every long-lived secret out of the browser.
- **Rejected — single Next.js monolith:** would force the DSP and scoring
  pipeline into Node or serverless Python shims — no librosa/ffmpeg parity,
  and multi-minute background scoring fights serverless execution limits.
- **Rejected — Python-only server-rendered app:** the WebRTC session room and
  ephemeral-secret flow are the product's core and are browser-native;
  server-rendered Python stacks make exactly that part hardest, and the web
  tier would still need a Node build for the Realtime client.
- **Revisit when:** v0.2 work (multi-session arcs, per-session cost metering)
  changes the worker's shape, or when operating three deploy units proves
  more overhead than the seam is worth at real usage volume.

## 007 — Implementer bake-off: Claude subagent default, Codex validated reserve

- **Decision:** the default implementer for plan tasks stays a Claude
  subagent; the Codex dispatch path (`/delegate-codex`) is kept as a
  validated reserve, not retired. Re-test on design-open tasks in v0.2.
- **Why:** Tasks 9 and 10 were deliberately shape-matched (an LLM judge
  module plus fake-client tests) and dispatched one to each implementer.
  Measured result — quality parity, friction asymmetry: wall time 4m00s
  (Codex) vs 3m51s (Claude); both 3 commits with clean TDD cadence, 4 tests
  added, review verdict Approved, 0 critical / 0 important findings, 0
  implementer-attributable minors, 0 rework rounds, 0 rule violations. The
  only separator was ops friction: Codex needed a uv-cache sandbox fallback,
  produced one placeholder author email, and carried worktree + merge
  overhead; the Claude path had none.
- **Rejected — Codex as default:** no measured quality or speed edge on
  shape-matched tasks to pay for the recurring ops friction.
- **Rejected — retiring the Codex path:** it passed review cleanly with zero
  rework; a second validated implementer is cheap insurance and enables
  parallel dispatch when task volume spikes.
- **Revisit when:** v0.2 offers design-open tasks (the pilot's shape-matched
  tasks measured execution discipline, not design judgment — the dimension
  where the implementers might actually differ), or the Codex tooling
  removes the sandbox and worktree friction.

## 008 — v0.2 ships product depth before payments (2026-08-01)

- **Decision:** the first paid transaction moves out of the near-term
  window; the merchant-of-record integration (DECISIONS 004) starts no
  earlier than v0.3. Each version ships one feature bundle: v0.2
  interviewer UX, v0.3 report quality, v0.4 session history, v0.5
  curriculum-lite, then payments. The PRD's original success metrics stay
  as written — this entry is the honest change log for the timeline shift.
- **Why:** the first real 20-minute user session (2026-07-29) surfaced
  interviewer-UX defects that define the product for its target audience of
  non-native English speakers: thinking pauses treated as end-of-answer,
  no active listening, no session-arc management. Charging for sessions in
  that state would burn the first paying cohort on exactly the behaviors
  they came for. Quality is the constraint; the schedule moves, not the bar.
- **Rejected — payments alongside the UX fixes in v0.2:** splitting one
  version across a payment integration and the audience-defining session
  fixes risks shipping both half-done.
- **Rejected — free early access as a bridge:** free usage does not
  validate willingness to pay and anchors the perceived price at zero.
- **Revisit when:** real-usage metrics show sessions completing cleanly
  through the new arc (v0.2) and report quality lands (v0.3) — payments
  then leads the following version.

## 009 — server_vad + create_response:false carries the silence machinery (2026-08-01)

- **Decision:** the interviewer session keeps `server_vad` (900 ms tail,
  300 ms prefix padding) and adds `create_response: false`; the web client
  owns ALL response timing — a debounce after real-speech commits, a
  stall-blip filter for sub-2 s episodes (fillers, coughs), and a silence
  clock that injects `[silence status]` notes with `response.create` at
  8 s / 15 s / 30 s of accumulated quiet.
- **Why:** measured bake-off (evals/reports/2026-08-01-f06-vad-bakeoff.md).
  semantic_vad at low eagerness never committed a fully complete answer in
  2/2 runs (Morgan goes silent forever); at auto eagerness it interrupted
  an 8 s thinking pause at ~4.4 s and the forced response invented content
  the candidate never said. Both settings also emit no events while holding
  a turn, starving the client clock. server_vad + create_response:false was
  deterministic in every scenario and fired zero uninvited responses (3/3),
  which moves the complete/thinking distinction into client code that unit
  tests and the adversarial harness can exercise.
- **Rejected — semantic_vad (either eagerness):** disqualified by the
  measurements above.
- **Rejected — longer silence_duration_ms alone:** taxes every transition
  including complete answers; kept only as a fallback knob.
- **Revisit when:** OpenAI ships a semantic_vad mode with event visibility
  during held turns and bounded commit latency, or live sessions show the
  client debounce adding perceptible lag after complete answers.
