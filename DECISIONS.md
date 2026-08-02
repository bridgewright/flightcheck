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

## 010 — identical JDs reuse their rubric instead of recompiling (2026-08-01)

- **Decision:** creating a package whose `jd_text` exactly matches a
  previously compiled, "ready" package — and which carries no
  personalization inputs (no resume, no LinkedIn) — copies that package's
  rubric and profile and is ready instantly. Everything personalized, and
  every unseen JD, compiles fresh.
- **Why:** a rubric compile costs a Gemini run and 100–200 s of measured
  wall clock. Packages are single-session in v0.1, so iterating on the same
  JD (the developer-testing loop today; a candidate re-attempting the same
  role tomorrow) paid the full price every time for a deterministic-enough
  output. Same input, same price paid twice is pure spend.
- **Rejected — hash-keyed cache table:** a content-hash column needs a
  migration; exact `jd_text` equality against the existing column gets the
  same hits for zero schema change. Revisit if fuzzy matching (whitespace
  variants) ever matters.
- **Rejected — caching personalized packages too:** a resume changes what
  the rubric emphasizes; serving a JD-only rubric to a personalized request
  would silently degrade it. Conservative scope keeps the quality bar.
- **Revisit when:** rubric compilation becomes fast enough (<10 s) that
  freshness beats reuse, or per-candidate rubric variation becomes a
  product feature.

## 011 — a commit pending across a suspension gap is dropped (2026-08-01)

- **Decision:** when the silence clock detects a suspension gap (a tick of
  ≥ 2 s — backgrounded tab, throttled timers, machine sleep), a response
  that was armed but not yet fired is dropped, not fired on return and not
  re-armed. The interviewer stays quiet; if the candidate stays quiet too,
  the stage-1 scaffold (which carries its own `response.create`) revives
  the conversation within 8 s.
- **Why:** the debounced response answers a *moment* — the candidate
  finishing a turn just then. After a parked minute that moment is gone;
  answering it on refocus is exactly the uncanny "the app was waiting to
  pounce" behavior the suspension guard exists to remove. The 8 s
  self-heal bounds the cost: worst case, a candidate who answered in the
  last 1.2 s before backgrounding waits eight extra seconds for Morgan.
- **Rejected — fire the pending response on return:** replays a stale
  reaction into a resumed room; indistinguishable from the scaffold burst
  bug from the candidate's side.
- **Rejected — re-arm the debounce on return:** answers a turn the
  candidate may no longer stand behind after stepping away; also makes the
  guard's "fresh stretch" promise false (state would survive the gap).
- **Revisit when:** real-usage sessions show candidates backgrounding the
  tab mid-answer often enough that the 8 s self-heal reads as Morgan
  ignoring them (F-13 metrics would show a spike of suspend-resume lines
  followed by candidate re-asks).

## 012 — canonical URLs are login-scoped ids; token links demoted to claim addresses (2026-08-03)

- **Decision:** the app's canonical URLs move to login-scoped, id-based
  routes — `/sessions/[id]`, `/sessions/[id]/room`, `/progress`, `/rubric`,
  `/packages`, `/settings`, with `/home` resolving an active package.
  `/p/[token]` is demoted to a claim/redirect address: it binds an unclaimed
  package to the first signed-in account, bounces an owner to the id routes,
  and answers a foreign owner with a real HTTP 403 page. Old token report
  and session URLs redirect to the new routes.
- **Why:** transcripts and voice replay now ride these pages, and a
  capability token in a URL leaks through browser history, pasted links,
  and referrer headers — the wrong risk profile for pages carrying a
  person's recorded voice. Cross-package screens (the archive, progress,
  settings) cannot be expressed under `/p/` at all. And payments (F-10)
  will retire loose tokens for provisioning anyway, so the migration only
  gets more expensive: today eight packages exist — this is the cheapest
  window there will ever be.
- **Rejected — keep token-capability URLs:** cannot express per-user
  screens, and every new page would widen the leak surface.
- **Rejected — run both URL spaces:** strictly more complexity — two
  authorization models forever, and every future screen decides twice.
- **Revisit when:** F-10 provisioning design, which decides how a paid
  package first meets its owner.

## 013 — transcripts persist before judging; audio and transcript retained (2026-08-03)

- **Decision:** the verbatim `TranscriptSegment` list is persisted to
  `sessions.transcript` (jsonb) immediately after transcription and
  *before* any judging — a session whose scoring later fails keeps its
  record. It is served only by a dedicated transcript endpoint, never on
  the hot session row (list and detail polls must not carry 25–60 KB they
  do not render). Raw audio and transcript are retained privately: they
  power scoring and the replay/proof-of-fairness surface ("this is what
  was scored — nothing else"). No automatic deletion yet.
- **Why:** the transcript viewer requires it. Until now the pipeline
  computed the transcript and discarded it, so showing one would have
  meant a fresh Gemini transcription call per view — paying repeatedly
  for an artifact the product already produced once.
- **Rejected — keep discarding:** the viewer is impossible, and
  regeneration costs a judge-model call per session per view.
- **Rejected — storage-bucket JSON files:** a second data path beside the
  database with no queryability, for data that is already row-shaped.
- **Revisit when:** a retention/deletion policy must be decided before
  payments open (F-10) or when account deletion ships — whichever comes
  first.

## 014 — scoring eligibility floors: below them, zero judge calls (2026-08-03)

- **Decision:** a session is scored only when duration ≥ 600 s AND
  candidate turns ≥ 5 AND candidate words ≥ 200. Any floor missed → zero
  judge calls, no report, terminal status `insufficient`, and the slot
  stays retriable (consistent with the guard-ended slot policy). Between
  the floors and the full-evidence bars (900 s duration, 600 candidate
  words) the report is marked `limited` and its limits note says so.
  Thresholds live in `config/product.toml` `[eligibility]`, not in code.
  Duration ground truth is the wav file itself, not transcript timestamps.
- **Why:** honest verdicts need evidence. A real interviewer who saw four
  minutes would say "we did not see enough" — not produce a number and
  stand behind it. Numbers from thin evidence would be a guess wearing a
  verdict's clothes, and the honest-verdict policy is the product.
- **Rejected — score everything:** dishonest verdicts from thin evidence.
- **Rejected — LLM-judged sufficiency:** spends judge money to decide
  whether to spend judge money; deterministic floors are free, auditable,
  and explainable to the user in one sentence.
- **Revisit when:** a real-usage duration distribution exists (F-13) to
  check the floors against how sessions actually run.

## 015 — the rubric page conceals the question bank (2026-08-03)

- **Decision:** `/rubric` shows dimensions, weights, signals, and BARS
  anchors — the bar itself — but never `question_bank`.
- **Why:** knowing the bar is preparation; knowing the exact probes is
  leakage. A candidate who rehearses the literal questions gets a verdict
  about their rehearsal, not their readiness — which corrupts the honest
  verdict that is the product's core promise. Fresh topics per session
  only mean something if the bank stays sealed.
- **Rejected — full transparency:** it reads as generous but quietly
  destroys the thing being sold; a "Ready" earned against known questions
  is a courtesy pass with extra steps.
- **Revisit when:** a separate practice mode ever splits rehearsal from
  assessment — rehearsal surfaces could then show questions openly.

## 016 — report headline is compile-side deterministic this batch (2026-08-03)

- **Decision:** the report's one-line headline is synthesized
  deterministically at compile time — verdict phrase plus the weakest
  dimension, language-linted, ≤ 120 chars. Judge prompts are untouched.
  The per-dimension `strengths`/`weaknesses` fields ship as empty defaults,
  pending a judge-authored pass validated at an eval gate.
- **Why:** evals run once per release gate (the API-cost rule), so a
  judge-prompt change made mid-batch would surface a regression at the
  gate — after the work, at the worst time. Deterministic synthesis is
  unit-testable today and cannot degrade the judges it does not touch.
- **Rejected — judge-authored headline in this batch:** an unvalidated
  prompt change riding a 40-commit batch, checkable only at the gate.
- **Revisit when:** the next eval-gated release — the judge-authored
  headline and the strengths/weaknesses pass go through it together.
