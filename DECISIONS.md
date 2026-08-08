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

*Superseded by 024 (2026-08-03): the default flipped to Codex. The pilot
measurement below stands as recorded; the "Rejected — Codex as default"
line no longer describes practice.*

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
- **Superseded in part (2026-08-03) — the version map above did not
  survive contact.** What actually shipped: the v0.3 work (report quality)
  and the v0.4 work (accounts, the complete signed-in webapp, session
  history, progress) landed in production but were **never tagged** — they
  are internal milestones folded into v0.5. Payments then shipped **as
  v0.5**, not after it, and curriculum-lite moved to v0.6+. The tag line of
  record is therefore v0.1.0 → v0.2.0 → v0.5.0; 0.3 and 0.4 are not being
  tagged retroactively, because a tag invented after the fact is not a
  release rhythm, it is a decoration. The entry's substance held — depth
  before payments, and payments still shipped last — but the numbered plan
  it published was wrong for two versions and is corrected here rather
  than rewritten above.
- **The retroactive-tag rule stated here is refined, not reversed, by 032
  (2026-08-04).** "A tag invented after the fact is a decoration" remains
  the rule. What 032 adds is the discriminator this entry did not need and
  a later release did: a tag may be cut after the fact **at the commit that
  was actually deployed**, and may not be **invented for a boundary that
  never shipped separately**. 0.3 and 0.4 are the second kind and are still
  not tagged. Also corrected: this note says curriculum-lite "moved to
  v0.6+". It shipped in neither v0.6 nor v0.7 and remains unbuilt.

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
- **Narrowed (2026-08-03), once accounts existed (022):** reuse is
  **same-account only** — `find_ready_rubric_by_jd(jd_text, user_id)`
  matches the requesting user's own "ready" packages and nothing else, and
  a request carrying no `user_id` never reuses at all. The rule as written
  above matched globally, which would have copied the source package's
  `candidate_profile` — one customer's own resume-derived name and
  background — onto another customer's package. Same JD across two
  accounts now pays for two compiles; that is the correct price.

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
- **Revisit answered (2026-08-03):** F-10 shipped in 017. A paid package
  meets its owner through their signed-in account; provisioning mints no
  token. 012 holds unchanged.

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
- **Revisit executed (2026-08-03):** 020 — retention, deletion, and refund
  surfaces shipped with payments. Still no automatic deletion.

## 014 — scoring eligibility floors: below them, zero judge calls (2026-08-03)

- **Decision:** a session is scored only when duration ≥ 600 s AND
  candidate turns ≥ 5 AND candidate words ≥ 200. Any floor missed → zero
  judge calls, no report, terminal status `insufficient`, and the slot
  stays retriable (consistent with the guard-ended slot policy). Between
  the floors and the full-evidence bars (900 s duration, 600 candidate
  words) the report is marked `limited` and its limits note says so.
  Thresholds live in `services/scorer/config/product.toml` `[eligibility]`,
  not in code. Duration ground truth is the wav file itself, not
  transcript timestamps.
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
- **Revisit fired, not acted on (2026-08-03):** the v0.5 gate ran and
  passed (`evals/reports/2026-08-03-v05-gate.md`), but the judge-authored
  pass did not ride it. The headline is still synthesized deterministically
  in `services/scorer/src/scorer/report/compile.py`, and
  `DimensionScore.strengths`/`weaknesses` still ship as empty defaults.
  Stated plainly because the gate does not cover it either: the v0.5 suites
  measure rubric discrimination and the delivery judge, not report field
  quality. Carried to the next eval-gated release.

- **Closure (2026-08-05):** the revisit condition fired. The judge-authored
  pass shipped through the v0.10.0 eval gate: key spans and per-dimension
  strengths/weaknesses are authored by the content judge, enforced and
  linted at compile. DECISIONS 043.

## 017 — merchant of record: Polar, verified for a KR individual seller (2026-08-03)

- **Decision:** payments run through Polar as merchant of record — hosted
  checkout only, provisioning driven by the `order.paid` webhook. The
  choice was settled empirically the same day: a Korean individual seller
  completed Polar signup, Stripe identity verification, and payout-account
  onboarding (South Korea, business type "individual") end to end. The
  product is listed at $49 one-time ("Interview package", per-JD, 30 days,
  6 sessions). Provisioning never mints package token links (012 holds).
- **Why:** decision 004 chose the MoR shape but left the provider open.
  Of the candidates, Polar was the only one whose Korea payout support
  was verifiable in public docs, and its fee on a $49 sale (≈ $3.7 with
  an international card, ~7.5%) sits under the ~10% revisit bar in 004.
  Lemon Squeezy carries an acknowledged migration path onto Stripe
  Managed Payments after the Stripe acquisition — a greenfield
  integration onto a platform that has pre-announced its own successor.
  Paddle's support for KR individual sellers could not be verified.
- **Rejected — Lemon Squeezy:** best webhook ergonomics
  (`meta.custom_data`), but building on a pre-announced migration is
  deferred rework; KR payout method also unverified.
- **Rejected — Paddle:** strongest tax machinery, unverifiable KR
  individual onboarding, slowest review reputation for small sellers.
- **Revisit when:** Polar's store review rejects the account; fees rise
  past ~10% effective; or payout reliability to KR proves poor in the
  first months of real settlement.
- **Not as clean as this reads (2026-08-03):** the Standard Webhooks
  verification Polar documents does not match how Polar's live deliveries
  are actually signed — every real `order.paid` 403'd against a
  spec-exact verifier. Recorded in full as 023. The provider choice
  stands; the integration cost one production incident more than the
  documentation implied it would.

## 018 — $49 single price and the trial-then-unlock package (2026-08-03)

- **Decision:** pricing is **$49 USD everywhere**, from one constant
  (`apps/web/lib/pricing.ts`) with a pinning test; the ₩89,000 figure is
  retired from every surface. The package model: the account's **first
  package is a trial** carrying one free session; **$49 unlocks the SAME
  package** — same JD, same rubric — to its full 6 sessions. One
  implementation consequence is recorded openly: the worker's quota
  chokepoint keys on `paid_at` alone, so **every unpaid package grants the
  1-session trial quota**, not just the account's first (`is_trial` marks
  records and copy, never quota). A second JD therefore also gets one free
  session before its $49 unlock. The exposure is bounded by the package
  cap (10/account) and the per-user create rate limits.
- **Why:** this revises 008's stance that no free tier exists. What 008
  actually protected was verdict integrity and cost discipline before the
  webapp existed; with accounts, quotas, rate limits, and caps now
  enforced worker-side, one free session per JD is the cheapest honest
  demo of the product's core (the verdict), and USD-only pricing keeps
  one price story for a global audience.
- **Rejected — account-wide single trial (0 sessions on later unpaid
  packages):** purer reading of "first package = trial", but it makes the
  second JD a blind $49 purchase and needs paywall states the batch would
  have shipped untested. Revisit at real conversion data.
- **Rejected — ₩ pricing or dual currency:** two price stories, FX drift,
  and the public repo's reviewers think in USD.
- **Rejected — launch discounts:** a discount on an honest-verdict
  product reads as bargaining with the bar.
- **Revisit when:** free-session farming appears in the metrics (many
  unpaid packages per account, sessions consumed, no conversions); or
  conversion data argues the trial should widen or narrow.

## 019 — the 30-day window starts at payment and closes the interview room (2026-08-03)

- **Decision:** `expires_at = paid_at + 30 days`, set once by the
  idempotent payment flip (replays can never move it). Expiry closes
  **every route into the interview room** — a distinct `package-expired`
  refusal (410), not the exhausted one — while reports, transcripts, and
  replays stay readable forever. Trials (no `paid_at`) never expire.
- **Why:** the clock starts when money changes hands, not when a rubric
  compiles — anything else charges the user for compile time or shelf
  time. Keeping artifacts readable is the retention promise of 013; a
  paid-for report that vanishes is confiscation, not expiry.
- **Rejected — expiry from package creation:** punishes the trial user
  who pays on day 20.
- **Rejected — full lockout at expiry:** simpler, dishonest.
- **Revisit when:** real usage shows 30 days misfits the interview-prep
  arc (utilization data, F-13).
- **Corrected (2026-08-03, same day):** this entry and its heading first
  read "expiry blocks **new session starts only**". That understated the
  blast radius of its own code. In the worker's `POST /sessions`
  (`services/scorer/src/scorer/api/routers/sessions.py`) the `is_expired`
  check runs
  **before** the retriable-resume branch, so after expiry a *resume* is
  refused too: a session already created and left `planned`, `failed`, or
  `insufficient` cannot be picked back up. The endpoint's own docstring
  says so — "410, resumes included". What genuinely stays open is every
  read (report, transcript, replay) and the scoring of a session that was
  already recorded: `POST /sessions/{id}/complete` carries no expiry check,
  so a session in flight when the window closes still gets its report.
  The sharp edge, stated rather than hidden: capacity unused at the
  boundary is gone, including the slot a `failed` or `insufficient` row
  would otherwise have handed back, and 020's refund window (14 days from
  payment) does not reach day 30. A last-day failure has no in-product
  remedy — only a support mail. Accepted for v0.5 as the price of a
  bounded window; F-13 utilization data is what would reopen it.
- **Address corrected (2026-08-04):** the paragraph above cited
  `services/scorer/src/scorer/api/app.py`. The route left that file in the
  v0.6 router split (`822c1c4`) and now lives in
  `services/scorer/src/scorer/api/routers/sessions.py` — `is_expired` at
  `:145`, the `package-expired` 410 at `:151`, and the quoted docstring at
  `:132`. `app.py` today defines no route handlers at all, so a reader
  following the old citation found nothing. The behaviour this entry
  describes did not change; only its address did. Found by the v0.6/v0.7
  release audit, which is the second time a decision in this log has aged
  into a dead path — see 020's own correction history.

## 020 — retention and deletion v0: policy page, mailto intake, operator purge (2026-08-03)

- **Decision:** executes 013's revisit condition. The privacy page states
  what is kept (recordings, transcripts, reports, orders — privately, for
  scoring and replay) and how deletion works today: a prefilled deletion
  email from settings, executed by the operator with
  `services/scorer/tools/purge_user.py` (dry-run by default, rows +
  storage objects) within a stated 7 days. The refund page states the
  honest-verdict rule: the verdict itself is never refund grounds;
  technical failures refund within 14 days. Legal copy renders its
  commercial numbers from `apps/web/lib/pricing.ts` — it cannot drift from
  the product.
- **Why:** charging money without deletion, retention, and refund
  surfaces is trust debt at the exact moment trust is being asked for;
  a manual process honestly described beats a self-serve flow shipped
  untested.
- **Rejected — self-serve deletion now:** needs auth-adjacent deletion
  endpoints and storage fan-out done carefully — scheduled as F-34
  (v0.6). ~~Rejected~~ — **overtaken; see the revisit note below.**
- **Rejected — no refund window:** "never" is not an honest answer to a
  broken recording.
- **Revisit when:** deletion requests exceed a manual cadence, or v0.6
  ships F-34 self-serve deletion.
- **Revisit executed (v0.6, 2026-08-03) — 025 supersedes the deletion
  half of this entry.** F-34 shipped, so the second condition fired. The
  product no longer works the way the Decision paragraph above describes:
  deletion is self-serve from settings
  (`apps/web/app/settings/delete-account.tsx`, rendered at
  `apps/web/app/settings/page.tsx:100`) and it is immediate, which is what
  the privacy page now tells the customer. `DECISIONS 025` carries the
  ordering guarantee that made it safe to ship — blobs before rows, and a
  partial failure deletes nothing. **What survives from this entry:** the
  operator purge script still exists and now runs the same code as the
  endpoint rather than a second implementation that could drift, and the
  mailto route remains for the one case self-serve cannot cover — a user
  who cannot sign in. The retention and refund halves of this entry are
  unchanged and still current.
- **Recorded (2026-08-04):** this note was written by the v0.6/v0.7
  release audit, the day after the condition fired — and only because an
  auditor went looking. F-34 shipped, 025 was written, and neither
  pointed back here. A revisit condition that fires and is never marked
  leaves the log telling a reader the wrong product, which is the failure
  mode this file exists to prevent.

## 021 — prompt-injection stance: fence now, detect later (F-11 split) (2026-08-03)

- **Decision:** v0.5 ships the injection **minimum**: every
  user-controlled text (JD, resume, LinkedIn, transcript) is
  delimiter-fenced at all prompt sites with fence-marker neutralization,
  the JD is truncated before the rubric compiler, and hidden text (HTML
  comments/tags, zero-width, bidi) is stripped once at intake. Judge
  RULE wording stays untouched. Detection-and-refusal, SSRF hardening,
  and an injection eval suite are **F-11b (v0.6)**.
- **Why:** fencing is a pure-loss-free containment change verifiable by
  unit test today; detection heuristics change judge behavior and must
  land behind the eval gate (evals run once per release — regressions
  from prompt drift would surface late and silently).
- **Rejected — shipping detection heuristics this batch:** unevaluated
  judge-adjacent changes violate the eval-gated release rule.
- **Rejected — doing nothing until v0.6:** a paid product that pipes
  raw user text into prompts is an open door; the minimum closes the
  cheap half.
- **Revisit when:** F-11b lands with the eval suite; or a live injection
  attempt is observed in transcripts.

## 022 — accounts: Supabase Auth, passwordless email links, no passwords (2026-08-02)

*Decided and shipped 2026-08-02; written down 2026-08-03, when the v0.5
audit found that nothing in this log covered the change that gates every
screen in the product.*

> **Superseded in part on 2026-08-04 by DECISIONS 036.** The passwordless
> email link described below is **removed**: sign-in is Google, and it is the
> only door. What still stands is everything this entry decided about identity
> itself — Supabase Auth as the provider, the `lib/viewer.ts` seam, the proxy's
> cookie refresh, `safeNextPath`, and `/auth/callback`. "No passwords" also
> still stands, and by a stronger route than this entry took: the product now
> holds no credential at all. Read the rest of this entry as history.

- **Decision:** identity is Supabase Auth — the same service that already
  holds the data (006). Sign-in is a **passwordless email link**
  (`signInWithOtp`, then `/auth/callback` exchanges the code for a
  session); **no password is ever collected, hashed, or stored**, so there
  is none to leak, reset, or stuff. `apps/web/proxy.ts` refreshes the auth
  cookie on an include-list matcher covering every signed-in surface plus
  `/api`, and redirects an unauthenticated page request to
  `/login?next=…`; the return path is validated by `safeNextPath` before
  it is ever followed. Screens and API routes read identity only
  through `getViewer()` in `apps/web/lib/supabase/server.ts`; the proxy in
  `apps/web/lib/supabase/middleware.ts` is the one other reader. The Google OAuth
  path is written, typechecked, and wired to the same callback, but ships
  **off** behind `GOOGLE_AUTH_ENABLED = false` in
  `apps/web/app/login/page.tsx`: the provider is not configured yet, and a
  button that dead-ends on a raw provider error page is worse than no
  button.
- **Why:** ids need an owner, and this landed first so that they could have
  one — 012 moved the canonical URL space onto accounts the following day. A recorded voice, a transcript, and a paid entitlement all
  have to belong to somebody, and "belongs to whoever holds this token" is
  exactly what 012 rejected. Supabase Auth was already on the other side of
  the database, RLS, and the storage buckets; a separate provider would add
  a second user table to reconcile with `packages.user_id` and every
  storage path. Passwordless then deletes a whole liability class for one
  honest dependency: email delivery becomes the only door into the account.
  That cost is stated rather than hidden — a cooldown-gated resend on the
  login page is the whole mitigation today.
- **Rejected — email and password:** a credential store this product has
  no use for. Hashing choices, reset flows, breach exposure, and support
  load, bought for an audience whose entire relationship with the product
  is one 30-day window.
- **Rejected — a second auth service, or hand-rolled sessions:** two
  identity systems to hold in sync with one `user_id` column, and every
  future screen deciding twice which one is authoritative — the same
  reason 012 refused to run two URL spaces.
- **Rejected — shipping the Google button as it stood:** it was live and
  broken; the OAuth redirect landed on a raw JSON error page because the
  provider was never configured. Behind a flag, the code path stays
  typechecked and enabling it later is one line rather than a rewrite.
- **Revisit when:** the Google provider is configured (v0.6) and the flag
  flips; or real-usage metrics show sign-in links failing to arrive, which
  is the specific failure mode passwordless buys.
- **Corrected (2026-08-04, third audit to find a false claim in this
  entry).** Two mechanisms above were described wrongly. The conclusions
  they support are both still true, which is exactly why nobody caught
  this by using the product.
  - **The identity seam is `apps/web/lib/viewer.ts`, not
    `apps/web/lib/supabase/server.ts`.** Forty files import
    `@/lib/viewer`; none imports `getViewer` from `supabase/server`, whose
    single caller is `viewer.ts` itself. `viewer.ts`'s own header states
    the rule — "Screens import ONLY this module". Three routes do import
    `createClient` from `supabase/server` directly (`app/auth/callback`,
    `app/auth/signout`, `app/api/account/delete`), but they need a
    Supabase client to exchange a code, end a session, or delete an
    account — not an answer to "who is signed in". The entry named the
    implementation and called it the seam.
  - **The Google flag is environment-driven and was never a literal
    here.** It is `GOOGLE_AUTH_ENABLED` in
    `apps/web/app/login/google-auth.ts:36`, computed from
    `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`, not `= false` in
    `app/login/page.tsx`. `apps/web/tests/google-auth.test.ts:40` asserts
    the source does **not** contain a hard-coded
    `GOOGLE_AUTH_ENABLED = true|false` — the tree actively forbids the
    thing this entry described. That test and the environment plumbing
    shipped in `6b30c70` (v0.6); the entry was written before it and never
    moved.
  - **The revisit is half-fired.** v0.6 made the flag environment-driven,
    which was the mechanical half. The provider is still not configured
    and the flag has not flipped: the deployed `/login` contains no
    occurrence of "google". So the entry's *conclusion* — the button is
    off — holds in production. Turning it on is tracked as F-44 and has to
    land before v1.0, because reviewers will sign in with it.

## 023 — Polar webhook: accept any derivation of the SAME secret (2026-08-03)

- **Decision:** `verifyWebhookSignature` (`apps/web/lib/polar.ts`) accepts
  a `v1` MAC computed under **any of three derivations of the one
  configured secret**: (a) the Standard Webhooks reading — base64-decoded
  bytes after `whsec_`, (b) the whole secret string as UTF-8 bytes, (c) the
  after-prefix string as UTF-8 bytes. Nothing else loosens. The signed
  content is still `{webhook-id}.{webhook-timestamp}.{rawBody}` over the
  **raw** body, the ±300 s tolerance is still enforced in both directions,
  and the compare is still `timingSafeEqual`; in the webhook route a
  missing secret is still a 503 that processes nothing, and any non-match
  is still a 403 that provisions nothing. Committed at `84e3434`.
- **Why:** the spec-exact implementation **403'd every real `order.paid`
  delivery in production**, while a locally signed spec-compliant payload
  verified green in the test suite. The test signed with our own code, so
  all it ever proved was that we agreed with ourselves. Polar's own
  verifier feeds the secret STRING to the HMAC; its docs base64-wrap the
  secret only to satisfy the `standardwebhooks` library, which decodes it
  straight back. The general lesson, and the reason this entry exists: **a
  signature test that signs with your own code proves self-consistency,
  not interoperability. A third-party signature scheme is verified only by
  a real delivery.**
- **The security bound, stated explicitly, because widening an accepted
  signature space is the right thing to interrogate:** all three
  derivations key on the SAME secret. The accepted set grows from one MAC
  to three — and an attacker without the secret can compute none of them,
  so it is three unguessable values instead of one, not a weaker check. A
  tampered body, a signature under a *different* secret in any of the
  three derivations, a stale or far-future timestamp, a non-`v1` scheme,
  and a wrong-length MAC are all still rejected, each with its own test in
  `apps/web/lib/polar.test.ts` — including "still rejects a signature
  keyed on a DIFFERENT secret in any derivation". Not widened: the signed
  content, the tolerance window, the constant-time compare, the
  fail-closed default.
- **Rejected — spec base64 only:** right against the document, wrong
  against the provider. It rejected 100% of real deliveries; a verifier
  that is correct in theory and refuses every authentic delivery is not a
  verifier.
- **Rejected — pinning to the literal-string key only:** hard-codes a
  vendor bug as our contract and breaks silently the day Polar conforms,
  with the failure mode "the customer paid and got nothing", found late.
  Accepting all three survives Polar changing its behaviour in either
  direction.
- **Rejected — adopting the Polar SDK:** a dependency plus a second
  secret-handling path for one HMAC. Recorded honestly rather than
  defended: Polar's documented integration wraps the secret in base64
  before handing it to the `standardwebhooks` library, so following that
  path would most likely never have hit this at all. The hand-rolled
  verifier cost a production failure and bought an exact understanding of
  what is being checked. At one webhook that trade still reads right; at
  ten it would not.
- **What "verified in production" means here, precisely:** the only live
  deliveries to date came from the project owner's own $49 order, placed
  to prove checkout → webhook → provisioning end to end and then
  self-refunded. There are no external customers and no external revenue.
  So this was verified by exactly one authentic delivery — which is still
  one more than any test suite could supply.
- **Revisit when:** Polar's live deliveries begin verifying under the spec
  derivation — evidence being a real delivery, never a documentation
  change — at which point the extra derivations are dead code and should
  be dropped; or a second webhook arrives, at which point a maintained SDK
  beats several hand-rolled verifiers.

## 024 — default track executor: Codex, with Claude on design-open tracks (2026-08-03)

*Supersedes 007.*

- **Decision:** the default executor for a new implementation track is
  **Codex**, working in its own worktree and branch against a
  self-contained brief, under the contract in `AGENTS.md`. A Claude session
  takes a track only when the work needs judgment a brief cannot fully
  specify — in-track design decisions, product-voice iteration, or
  exploration that will not reduce to an enumerable owned-file list — and
  the brief records the reason. The controlling session does not take
  implementation tracks; it plans, reviews, cherry-picks, and runs the
  release gates.
- **Why:** 007 said in its own revisit condition that it had measured the
  wrong dimension — shape-matched tasks measure execution discipline, not
  design judgment. What settled it was not a rerun but a change in the
  shape of the work. The v0.3–v0.5 arc ran as many independent tracks with
  non-overlapping file ownership: work a brief can specify completely, and
  mostly not design-open — the one dimension 007 named as the place the
  executors might actually differ. Making Codex the default and assigning
  a Claude session only where a brief runs out spends the scarcer
  capability where it changes the outcome, instead of spreading it evenly
  across work that is already fully specified.
- **The friction 007 measured did not disappear; it is priced in.** The
  delegated CLI executor set the wrong commit identity **four separate
  times**, each caught and corrected at cherry-pick. That correction is the
  only reason the public history carries one author. It is now a standing
  step in integration rather than a recurring surprise.
- **Rejected — leaving 007's default in place:** it had already stopped
  being true. A decision log that misstates who writes the code is worse
  than a missing entry, because a reader has no way to tell which of the
  remaining entries are live.
- **Rejected — a single executor for every track:** the assignment rule
  exists because the failure modes differ. A brief that cannot be
  completed without design calls does not improve by going to a faster
  implementer; it needs an executor that can be handed the intent instead
  of the file list.
- **Recorded late, which is the defect this entry closes:** the directive
  dates to 2026-08-01. Until 2026-08-03 the public log said the opposite,
  across the whole arc it was wrong about. Found by the v0.5 release
  audit, not by a reader — and a reader is who it would have misled.
- **Revisit when:** a track review finds a quality gap that tracks to the
  executor rather than to the brief; or commit-identity contamination
  stops being reliably catchable at cherry-pick, at which point the ops
  cost is no longer bounded.

## 025 — account deletion: blobs first, and a partial failure deletes nothing (2026-08-03)

- **Decision:** self-serve deletion removes recordings from the storage
  bucket **before** any database row, and a bucket object that will not
  delete aborts the whole run before a single row is touched. Every half is
  idempotent — an object or row already gone counts as done, never an error
  — so a failed run can simply be retried. The web route calls the worker
  first and removes the Supabase auth user last. If the worker refuses, the
  account and the sign-in are left exactly as they were and the customer is
  told **nothing was deleted**; if the worker succeeds and the auth delete
  then fails, that is reported honestly rather than hidden.
- **Why:** the loss is asymmetric. Session rows are the only index to the
  recordings-bucket keys, so deleting rows first and then failing strands
  recordings that nobody can ever locate again — a privacy promise broken
  silently, discoverable by no one, fixable only by a bucket-wide audit.
  Deleting blobs first and failing leaves the account completely intact:
  the plan recomputes identically and the honest answer is "nothing was
  deleted, try again". Ordering the auth delete last follows from the same
  rule — the sign-in record is the customer's only route back to retry.
- **Rejected — rows first, blobs second:** the natural reading order, and
  the one that produces unreachable orphaned recordings on any storage
  flake.
- **Rejected — best-effort continue-on-error:** it converts one failure
  into a half-deleted account with no way for the customer to finish or
  restart, and no way for the operator to know which half is missing.
- **Rejected — soft delete with a grace period:** a retention promise that
  keeps the data is not a deletion; v0.7 may add an export before deletion,
  which is a different feature.
- **Revisit when:** deletions grow large enough that one abort-and-retry is
  materially worse than resuming a partial run, or when export lands and
  the two need to share a plan.

## 026 — CSP without a nonce, and what that costs (2026-08-03)

- **Decision:** the Content-Security-Policy ships without a nonce.
  `frame-ancestors 'none'`, an explicit `connect-src` allowlist,
  `form-action` scoped to the checkout origins, and `Permissions-Policy`
  granting the microphone on the room route only.
- **Why:** a nonce has to be minted per request, which forces every page
  that carries inline framework bootstrap into dynamic rendering. `/login`
  and the landing are prerendered on purpose — they are the two routes a
  cold reviewer and a paying stranger hit first — and a nonce CSP renders a
  prerendered page as a blank screen. A policy that constrains where the
  browser may *talk*, *submit*, and *embed* is the half that stops the
  attacks this product can actually suffer; script-source strictness is the
  half that would cost the landing page.
- **Rejected — nonce plus all-dynamic rendering:** strictly stronger on
  script injection, paid for with the prerendered landing and login.
- **Rejected — hash-based SRI for the inline bootstrap:** the hashes change
  with every framework build, so the policy silently rots into
  unsafe-inline the first time a build is not re-hashed.
- **Revisit when:** every route that must stay fast is server-rendered
  anyway, or the framework serves a stable nonce without forcing dynamic
  rendering.
- **Verification note:** the webhook's raw-body verification was proven
  under the new headers with a real signed delivery against a running
  server; the Supabase code exchange and a live WebRTC room remain for the
  production smoke, and are named as such rather than assumed.
- **Corrected (2026-08-04):** this entry said "four-origin `connect-src`".
  The deployed policy carries **six** tokens — `'self'`, the Supabase
  origin, `api.openai.com`, and three Sentry ingest hosts spread in from
  `sentryOrigins` at `apps/web/lib/security-headers.ts:95`. Read off the
  live response header, not the source. **The count is now stated nowhere in
  prose** and is read off `security-headers.ts` or the served header instead:
  an origin count that lives in a sentence is one a new dependency falsifies
  silently, which is exactly what happened here. (An earlier draft of this
  correction claimed the code already pinned the count, citing a comment four
  lines above the allowlist. That comment is about inline styles under
  `style-src`, not about origins — a wrong citation inside a correction,
  caught by the round that re-read this batch.) **How it happened is the more
  useful half**: Sentry entered the
  product with no decision entry at all (now 033), and an undocumented
  dependency silently invalidated a number in an entry that *was*
  documented. An unlogged decision does not only leave a gap where it
  should be — it corrupts the entries around it.

## 027 — prompt injection: fence, then detect, then refuse out loud (2026-08-03)

*Completes the split opened in 021.*

- **Decision:** user-controlled text stays fenced at every prompt site
  (021), and on top of that a classifier refuses at intake, with a message
  naming what it saw, when a submission reads as an instruction set rather
  than a job description. The suite that gates it lives in
  `evals/suites/injection/` with committed hostile and benign fixtures and
  two baselines: hostile recall and, deliberately, a **zero** tolerance for
  benign false positives.
- **Why:** the JD is attacker-writable and lands in the prompt that builds
  the scoring bar, so an unrefused instruction set rewrites the standard
  the customer is judged against. Refusing silently would be worse than not
  refusing: the customer paid, and a package that fails without saying why
  is indistinguishable from a broken product.
- **Rejected — sanitize and score anyway:** guesses at intent, and a
  rewrite that drops the attack also drops the parts of a real posting that
  looked like it.
- **Rejected — a stricter classifier:** the first draft refused ordinary
  postings in this product's own target market — prompt-engineering roles
  whose real responsibilities include rewriting system prompts. A false
  refusal blocks a paying customer at the door, which is why the benign
  false-positive baseline is zero rather than small.
- **Revisit when:** the eval suite's hostile set stops finding new shapes,
  or a real customer hits a false refusal.

## 028 — one live session per package, released only by the hard cut (2026-08-03)

- **Decision:** a package may have one live session at a time. A second
  start returns a distinct `session-in-progress` refusal, and the web
  states plainly that no session is consumed. The lock is released when the
  live session ends or reaches its 25-minute hard cut.
- **Why:** two tabs recording the same session both mint upload URLs and
  both write, so the second upload overwrites the first — the customer's
  interview, gone, with no error anywhere.
- **Rejected — the previous free resume of a `planned` row:** it was the
  recovery path, and it was also exactly the race. Keeping it meant keeping
  the overwrite.
- **Known cost, stated rather than buried:** a customer whose tab crashes
  one minute in waits out the rest of the hard cut before starting again.
  The batch spec claimed the reaper would release these rows; that was
  wrong, and the review caught it — `reap_stuck` touches `compiling`
  packages and `scoring` sessions, never `planned` ones. The 25-minute cut
  is the only release valve. No session is consumed, so the cost is time,
  not entitlement.
- **Rejected — a shorter staleness window instead of the hard cut:**
  nothing touches `updated_at` during a live interview, so a genuinely live
  session would look stale within minutes and the lock would stop working.
- **Revisit when:** the room reports a heartbeat, which is what would let
  the owner reclaim their own dead session immediately instead of waiting.
  That is the fix; it is v0.7 work, not a copy change.

## 029 — the capability window: revocation now, expiry not yet (2026-08-03)

- **Decision:** migration 006 added `access_token_expires_at` and
  `token_revoked_at`; the web honours both on every path that **grants**
  room access, and the worker's session reads now select them. Nothing
  mints an expiry automatically. Revocation is operator-driven and works
  end to end today.
- **Why:** shipping the read path is what makes revocation real — before
  it, a revocation written into the database could never reach the code
  that honours it, which is enforcement with no signal. Minting an expiry
  is a different question, because a window that is too tight locks a
  customer out of an interview they are in the middle of.
- **Rejected — expiry at session creation:** the obvious default, and the
  one that ends a session for a customer who opened the room, stepped away
  for a call, and came back.
- **Rejected — leaving the columns unselected until expiry exists:** it
  keeps a guard that cannot ever fire, and the CHANGELOG would have to
  claim a capability window that does nothing.
- **Deliberately not gated:** the recording upload and the completion call.
  An interview that already happened is evidence a customer paid for, and a
  capability that lapsed at minute 19 of a 20-minute session must not be
  the reason it is thrown away. Revocation stops the next session, not the
  one already recorded.
- **Revisit when:** the heartbeat from 028 exists — the same signal that
  tells us a room is alive is the one that can safely bound its token.

## 030 — the landing rubric preview is removed, the day it shipped (2026-08-03)

*Closes F-45. Reverses the v0.6 batch's headline landing feature.*

- **Decision:** the pre-signup rubric preview comes out whole — the hero
  widget, the web route and its guards, the worker's preview module and its
  router. The hero returns to a single column that makes the argument in
  words. Nothing about it is kept behind a flag.
- **Why:** on the page it read as an unexplained box. A small eyebrow, a bare
  textarea, and a button that is correctly disabled until you type something
  — offered to a stranger *before* the page had told them what this product
  is. The interaction arrived ahead of the argument for it, so a visitor met
  a form with no reason to fill it in. The engineering was sound and the
  guards held in production; the placement was the defect, and a widget that
  needs the surrounding page to explain it is not a hero.
- **What this gives up, stated plainly so nobody rediscovers it as a
  surprise:** this was real competitive white space. No candidate-side
  product in the surveyed set shows the scoring bar before signup, and
  "paste the JD you are actually facing and see the bar" is still the
  strongest one-line argument this product has. Removing it is a trade, not
  a cleanup.
- **What it buys back:** the product no longer exposes any unauthenticated
  model call. The per-visitor window, the global daily ceiling, the
  concurrency slot and the deadline existed only to hold that one lever shut;
  they go with it, and so does the class of abuse they were built for.
- **Rejected — restyle it in place now:** the fault is placement and framing,
  not pixels, and F-21 rebuilds this page anyway. Keeping a confusing widget
  live in order to rework it twice is worse than removing it once.
- **Rejected — keep the endpoint, drop the widget:** an unauthenticated model
  call with no caller is attack surface with no product behind it.
- **Rejected — put it behind a flag:** dead code on the landing page is how a
  half-decision survives a release, and the guards would still need
  maintaining for something nobody can reach.
- **Revisit when:** the landing makes its case before it asks for anything,
  and there is a point on the page where "now see the bar for your own job
  description" is the obvious next step rather than the opening move. F-21 is
  where that either becomes true or does not.
- **Revisit fired, not yet acted on (2026-08-04).** F-21 shipped and the
  condition reads as substantially met. The deployed landing now opens with
  the claim — "Would you pass the interview today?", then "Paste a job. Talk.
  Read the verdict." — and its first how-it-works step is "Paste the job
  description". That step is exactly the place this entry described as the
  natural one: the page has made its argument by the time the reader reaches
  it. **Whether to reinstate the preview is a product call that has not been
  made**, and it is not free — bringing it back re-opens the only
  unauthenticated model call in the product and every guard that existed to
  hold it shut. What this note settles is only that the condition this entry
  set has occurred, so the question is live rather than dormant. Recorded
  because the alternative — a fired condition left silent — is how a decision
  log stops being a decision log. Registered for revisit as F-45; this entry
  is the public half of that.

## 031 — two client dependencies, and the boundary they are allowed to cross (2026-08-04)

*F-21. The product's first runtime client dependencies.*

- **Decision:** `motion` and `@phosphor-icons/react` enter the web app, under
  two rules. Motion is confined to the client leaf components under
  `components/motion/` that take only presentational props and render their
  children — `Reveal.tsx` and `MountReveal.tsx`, with `entry.ts` beside them
  exporting the shared constants and no component; every screen using them
  stays a server component. Icons are
  imported from `@phosphor-icons/react/ssr`, the tree-shaken server entry, and
  only where a glyph carries state a word would carry worse — a disclosure
  caret, an accordion's plus and minus.
- **Why motion:** the scroll-reveal rhythm is the part of the reference the
  user named explicitly and it cannot be faked with CSS alone at this quality.
  `IntersectionObserver` plus a class toggle was the alternative, and it is
  what we would have written: about eighty lines of our own observer,
  reduced-motion handling, and cleanup, in a component that must not leak the
  observer across route changes. That is a worse trade than a dependency whose
  entire job is that problem.
- **Why the icons:** three glyphs, in two components. The honest reckoning is
  that this is a large dependency for a small need, and it is justified only by
  `/ssr` making the cost proportional: nothing but the imported glyphs reaches
  the bundle. If it ever stops being a handful and starts being a set, this
  becomes an inlined SVG file instead.
- **What this costs:** the RSC boundary is now something to defend rather than
  something the architecture guarantees. `79838fd` closed a leak where a
  signed-in screen handed a start capability to a client component, and every
  client component added since is a place that could recur.
  `tests/room-token-hygiene.test.ts` and `tests/token-in-href.test.ts` watch
  for it; a new client component is a review item, not a routine addition.
- **Rejected — hand-rolled reveals:** see above. We would own the bugs and
  save nothing a reader can perceive.
- **Rejected — no motion at all:** tried first, and it is the version the user
  compared unfavourably to the reference. Stillness read as unfinished rather
  than as restraint.
- **Rejected — an icon font:** a second loading strategy, a flash of missing
  glyph, and no tree-shaking.
- **Revisit when:** either dependency is used by more than the surfaces listed
  here, or a client component appears that takes anything but presentational
  props. Both are conditions a reviewer can check rather than judgement calls.
- **Count corrected (2026-08-04):** this entry said "three leaf components".
  There are two. `RevealGroup.tsx` was the third and was deleted in `111d4d1`,
  **fifty-two minutes after this entry was written** — and that same commit
  edited this file without touching the number. Two places in the tree already
  contradicted it: `apps/web/tests/landing-motion.test.ts:199` ("RevealGroup is
  not here because it no longer exists") and `RETRO.md`'s note that it was a
  client component whose comment claimed four call sites and had zero. The
  glyph count in the paragraph below — three glyphs across two components — was
  wrong in its first draft, corrected the same day, and is now right. This is
  the second miscount in one short entry, which is the argument for the rule
  the audit adopted: a number in prose is a claim, and a claim is checked by
  counting, not by remembering.

## 032 — a tag is retroactive only where the release boundary is (2026-08-04)

*Written because cutting `v0.6.0` and `v0.7.0` today contradicts, on its face,
a rule this repo states in four places.*

- **Context:** 008 refused to tag v0.3 and v0.4 after the fact, on the
  grounds that "a tag invented after the fact is not a release rhythm, it is
  a decoration". `docs/releases/v0.5.md`, `CHANGELOG.md` and `README.md`
  repeat it. Two batches have since shipped, been deployed, and gone
  untagged: the v0.6 "operate at scale" batch, deployed 2026-08-03 at
  `da254e3`, and the F-21 design pass, deployed 2026-08-04. A hundred
  commits now sit past the last tag — the second-largest gap in the project's
  history, after the 146 between v0.2.0 and v0.5.0, and a straightforward
  failure of the weekly-tag rhythm the repo holds itself to.
- **Options:** (a) leave both untagged and let a future v1.0 absorb a
  hundred commits; (b) one tag covering both batches; (c) two tags, each at
  the commit that was actually deployed.
- **Choice:** (c). `v0.6.0` at `da254e3`; `v0.7.0` at the release commit that
  carries this batch's audit fixes on top of the deployed design pass —
  **deployed first, then tagged**, in that order. The rule below says a tag goes
  on the commit that was actually deployed, so `v0.7.0` is not cut until its
  commit is serving in production and has been read there. Tagging first and
  deploying afterwards would make this entry's own rule false for the tag it was
  written to justify.
- **Why, and this is the whole of it:** 008's rule was aimed at a tag with no
  release behind it. v0.3 and v0.4 never had a separable deployed boundary —
  they were folded into v0.5 precisely because there was nothing distinct to
  point a tag at. v0.6 and F-21 are the opposite case: each is a distinct
  commit that was built, deployed, and served to the public on a distinct
  day. The tag does not invent the boundary; the boundary already exists in
  the deployment record and the tag names it. So the rule sharpens to: **a
  tag may be cut after the fact at the commit that was actually deployed, and
  may not be invented for a boundary that never shipped separately.**
- **What this costs, stated rather than discovered later:** the tag dates are
  later than the commits they point at, and `v0.6.0` points at a tree whose
  version manifests read `0.5.0`, because `da254e3` is not going to be edited
  to make a version string agree with a tag applied afterwards. Both are
  disclosed in the release notes. The repo already has this disclosure
  pattern: `CHANGELOG.md` records that `v0.1.0`'s heading is dated by its
  notes while the tag object itself was created on 2026-08-01.
- **Also disclosed, because it is the sharper problem:** neither batch has an
  eval gate run of record. `evals/reports/` has nothing after
  `2026-08-03-v05-gate.md`, and both batches were deployed. Non-negotiable 3
  says the suites pass "before any tag", so the letter held — nothing was
  tagged — but `docs/deploy.md` puts the gate in the pre-deploy checklist and
  the deploy happened anyway. One run on the tag tree covers both tags and
  says so in words; it cannot retroactively make a gate have run at
  `da254e3`, and the notes do not pretend otherwise.
- **Rejected — (a), let v1.0 absorb it:** the tag rhythm is not a bookkeeping
  preference — a repo that claims a weekly release rhythm has to have the tags
  and the release notes to show for it, and an eighteen-day silence between
  v0.5.0 and v1.0 does not. It also buries two genuinely different releases
  inside a third.
- **Rejected — (b), one tag for both:** cheaper and defensible, but it
  invents a boundary too — it merges two things that shipped a day apart to
  different production builds, and the CHANGELOG had already been written
  keeping them separate because they are separate.
- **Rejected — moving `v0.6.0` forward to a commit whose manifests read
  `0.6.0`:** buys a cosmetic agreement by giving up the property that makes
  this defensible at all, which is that the tag sits on the deployed commit.
- **Revisit when:** a batch is deployed without a tag again. The right
  response then is not another 032 — it is to fix the release process so the
  tag and the deploy are one step. `docs/deploy.md` §5.2 has been amended in
  this batch to write the release notes and publish the GitHub release,
  which is the half that was missing and the reason this entry is needed.

## 033 — error monitoring: Sentry on both runtimes (2026-08-03, logged 2026-08-04)

*Logged a day late, by the release audit. `@sentry/nextjs` entered the web
app in `1659c99` with no entry at all — in the same commit range as the two
dependencies 031 does document, and 031 exists precisely to close this gap.
The Python side has carried `sentry-sdk` since before v0.5.0 (`5cab632`) and
was equally undocumented.*

- **Context:** failures were previously discovered by a customer saying so.
  A product that records voice, stores transcripts, and takes payment needs
  to know when it breaks before the customer tells it.
- **Options:** (a) structured logs only, read by the operator on demand;
  (b) a self-hosted error collector; (c) a third-party error-monitoring
  service on both runtimes.
- **Choice:** (c), Sentry, on the Next.js app and the Python worker, with
  alert rules recorded as configuration rather than as clicks someone once
  made in a console.
- **Why:** the operator is one person who is asleep for eight hours of every
  day this product is meant to be usable in. (a) requires someone to already
  suspect a problem, which is the thing being fixed. (b) is a second service
  to run and page for, to avoid sending stack traces to a vendor — a poor
  trade at this size.
- **What it costs, and the boundary drawn around it:** a third party receives
  crash reports from a product whose subject matter is personal.
  `send_default_pii=False` on the Python side
  (`services/scorer/src/scorer/observability.py:96`) is the line: identifiers
  and stack traces go, user content does not. **No recording, transcript,
  report body or job-description text is ever sent to it.** The browser-side
  reporter ships in the bundle but is inert unless a client DSN is set, which
  production does not currently set. Three Sentry ingest hosts are in the
  CSP's `connect-src` as a result — see the correction on 026, which this
  entry's absence had quietly falsified.
- **Rejected — (a) logs only:** the failure mode it leaves open is the one
  that already happened.
- **Rejected — (b) self-hosted:** infrastructure the operator would then have
  to monitor, which is the original problem one level down.
- **Rejected — sending PII to make debugging easier:** a transcript in an
  error report is the customer's interview in a vendor's database. If a class
  of bug genuinely cannot be diagnosed without content, that is a reason to
  add a redacted, purpose-built field, not to open the default.
- **Revisit when:** a browser DSN is configured — the privacy policy's
  wording has to match it, and this batch already corrected that clause to be
  true under both configurations; or the alert volume becomes noise, at which
  point the rules are the thing to change rather than the service.

## 034 — the worker survives its own history: backoff, a concurrency limit, a deadline, a dead letter (2026-08-03, logged 2026-08-04)

*Also logged by the release audit. The whole "pipeline survives its own
history" section of the v0.6 changelog shipped with no entry behind it, and
one part of it has a production incident in its history.*

- **Context:** the scoring pipeline is a chain of expensive, slow, failure-prone
  model calls behind a worker with finite memory, and v0.6 is the release whose
  premise is that the operator can be away for a week.
- **Options:** (a) fail fast and surface errors to the customer; (b) a job queue
  with multiple workers; (c) in-process resilience primitives — retry with
  backoff, a concurrency limit, a deadline, and a dead-letter record.
- **Decision:** (c), four parts, each with a live alternative:
  - **Backoff on every model call site.** The audit that opened this work found
    one of seven covered. A discovery-based test then found **eleven** call
    sites rather than seven, and pins the count so a twelfth cannot ship
    without failing the gate. Transcription got it first: the most expensive,
    least replaceable step, and the one that had none.
  - **A scoring concurrency limit plus a memory guard.** Measured peak is
    ~1.6GB; two concurrent scorings is an out-of-memory kill **that has already
    happened once in production.** Serialised rather than scaled, because the
    honest constraint is one box.
  - **An overall job deadline**, so one job cannot hold a worker thread for
    fifty minutes by chaining per-call timeouts that are each individually
    reasonable.
  - **A dead-letter record for permanently failed jobs**, with an endpoint to
    read it.
- **Why the counts matter more than the mechanisms:** every one of these is a
  mechanism any competent engineer would name. What the batch actually learned
  is that the enumeration is the hard part — "we added backoff" was true and
  covered one site in seven, and the only thing that made it true in general
  was a test that discovers the call sites instead of listing them.
- **Rejected — fail fast on transient model errors:** hands the customer a
  failed interview for a 503 that would have cleared in two seconds.
- **Rejected — a job queue with multiple workers:** the right answer at a size
  this product does not have, and it converts a memory limit into an
  infrastructure bill and a distributed-state problem.
- **Rejected — unbounded retries:** an id that will never resolve becomes a
  worker thread occupied forever. The deadline and the dead letter exist
  precisely so a permanent failure ends as a record instead of as capacity.
- **Rejected — discovering failures by customer complaint:** the status quo
  this replaced.
- **Revisit when:** the concurrency limit becomes the bottleneck under real
  load — which needs users, so F-13's utilization data is the trigger — or a
  twelfth model call site fails the discovery test, which is the point at
  which someone should ask whether the pipeline has grown a shape nobody
  designed.

## 035 — one design system, enforced by the test suite, and rebuilt mid-batch from measured values (2026-08-04)

*F-21. Logged by the release audit: a design system, a CI gate gone in to
enforce it, and a wholesale rebuild of it inside one batch, none of it in this
log. 031 recorded the two npm packages the pass introduced and not the system
they were introduced for.*

- **Context:** the product had `dark:` variants throughout, roughly six hundred
  raw colour literals across forty-odd files, and a house style that existed as
  prose. It rendered as a different product depending on the reader's operating
  system setting.
- **Options:** (a) keep the prose style guide and review by eye; (b) tokens
  plus a written rule; (c) tokens plus scans in the test suite that fail the
  build on a violation; and, separately, two themes or one.
- **Decision:** (c). Every colour, type step, radius and shadow is declared once in
  `app/globals.css`, composed in `lib/ui.ts`, and **enforced by scans in the
  test suite** that walk `app/`, `components/` and `lib/` and fail on a raw
  palette utility, an arbitrary colour, a pixel font size, a CSS gradient, a
  hand-rolled page column, or a dash in a sentence a reader sees. Light only:
  the dark variant is rebound to a class nothing sets. Contrast is computed and
  gated rather than asserted.
- **Why enforced rather than written down:** the previous version of this rule
  *was* written down, was believed, and scanned exactly one directory — the
  eight components under `components/landing/`, walked by a `readdirSync`. The
  batch's own measurement is the argument: all eight scanned files had zero raw
  colour literals, while the hundred and eight source files with no scan
  included forty-five carrying about six hundred between them. A house rule
  holds as far as CI enforces it and no further.
- **The rebuild, which is the part worth logging.** The system was built twice.
  The first pass was built from a prose description of the design reference and
  shipped a 110% root, a serif display face, ~56px pill controls and 62px
  headings. The user put the two side by side and named four faults; the second
  pass rebuilt it from the reference's **measured computed styles**, which
  reversed the earlier "110% is the new 100%" direction, removed the serif after
  one day, and set controls to 7px rectangles.
- **Rejected — keep the first system and adjust it in place:** the faults were
  not individually tunable; the root size, the type scale and the control
  geometry are one system, and adjusting them one at a time is how a design
  arrives at a shape nobody chose.
- **Rejected — describing the reference and building from the description:**
  this is the actual lesson. A prose description of a design is a lossy encoding
  of it, and the loss is invisible until someone sees both. Measure the artifact.
- **Rejected — keeping both themes:** two products to design, review and screenshot,
  for a reader who never asked for the choice.
- **What was deleted, on a stated principle:** `CARD_RAISED`, `--shadow-raise`,
  `ScreenFrame`, `Showcase` and `RevealGroup` came out because nothing rendered
  them. **A token or component nothing renders is a claim the design makes that
  no screen has to keep.** The cost is real and is being paid now: the four
  captioned product-screenshot slots are gone, so restoring them needs a
  component as well as image files.
- **Revisit when:** a screen needs a second theme for a reason the product can
  state — the interview room is the live candidate, since a voice surface may
  want a dark ground, and that would be its own decision rather than a
  reopening of this one; or a scan starts failing more often than it catches
  anything, which is the signal that a rule is wrong rather than unenforced.

## 036 — one door: sign-in is Google, and the email link is removed (2026-08-04)

- **Decision:** `/login` offers a single action — **Continue with Google**.
  `signInWithOtp`, the email field, the sent state and the resend cooldown are
  removed, and so is `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`: the flag existed
  because the provider was not configured, and a sign-in button behind a flag
  is how a login screen ships with no way into it. Configuring the Google
  provider is therefore a **prerequisite of the deploy, not a follow-up** —
  with the email link gone there is no second door to fall back to.
  `/settings` loses the change-sign-in-address form (F-35, shipped in v0.6):
  under Google the address on the account is the Google account's, and a form
  here would change our row without changing anyone's credential. Everything
  022 decided about *how identity is read* stands unchanged — Supabase Auth,
  the `lib/viewer.ts` seam, the proxy's cookie refresh, `safeNextPath`, and
  `/auth/callback` exchanging a code for a cookie session.
- **Why:** passwordless made email delivery the entire auth surface, and 022
  said so in the sentence that admitted the cost. What that bought in
  practice: a sender the product does not control, on Supabase's built-in
  service, which its own documentation describes as rate-limited per hour,
  best-effort, and not for production use — under a message whose body never
  said "flightcheck", carried "powered by Supabase", and offered to
  unsubscribe the customer from their own sign-in link. Google is the account
  this product's customers already have. It arrives with the address verified,
  it costs no credential store, no reset flow, no mail template, no sender
  domain and no DNS, and it removes the failure mode where a paid package sits
  behind a message that never arrived.
- **What this costs, unhedged:** a customer with no Google account cannot sign
  in at all. There is no fallback door by design, and the product does not
  pretend otherwise.
- **Rejected — email and password (F-52, proposed and killed the same day):**
  it would have reversed 022 to buy a credential store, a reset flow, breach
  exposure, a leaked-password check, a rate limit on the product's first
  guessable secret, and two further transactional emails — four branded
  templates, a sender domain and SPF/DKIM/DMARC records — to arrive at the
  same signed-in state that one Google button reaches. The card is closed as
  rejected rather than deferred: the work it described is not wanted later
  either.
- **Rejected — keeping the email link beside Google:** two doors into one
  account is the configuration that splits accounts. The same address can
  arrive by either provider, and Supabase links identities only on a
  **confirmed** email — an unconfirmed one is a pre-account-takeover risk it
  deliberately refuses to link — so the split account is the one holding a
  paid package. Keeping it also keeps the entire email surface it was supposed
  to justify: the templates, the sender, the throttle. The one real argument
  for keeping it was the accounts that already exist, and that argument does
  not survive contact with the data (below).
- **Rejected — GitHub as a second provider:** offered and declined by the user
  on 2026-08-04. One door until a customer asks for a second.
- **Migration — verified, not assumed:** every account in the live project is
  an email-confirmed `gmail.com` address (`select … from auth.users`, run
  2026-08-04, n=2). Supabase links a new identity to the existing user when
  the email is confirmed, so signing in with Google lands on the same
  `user_id` that already holds the packages, sessions, and the only order on
  the books. **That is a documented mechanism plus a matching data shape, not
  an observed sign-in** — it is not verified until a real Google sign-in on
  production lands on the existing account with its order intact, and that
  walk is part of shipping this, not a check to be done afterwards.
- **Verified on production the same day, by signing in rather than by reading
  settings back.** Google Cloud project `flightcheck-504509`, consent screen
  external and published to production, OAuth client pointed at Supabase's
  `/auth/v1/callback`, provider enabled through the Management API. The
  sign-in was then walked end to end: `/login` offered one button, Google
  asked only for name and email address, and the return landed on the
  **existing** account with its package, its Aug 3 session and its paid order
  intact. The database agrees: users 2 before and after, identities 2 to 3,
  one `google` and one `email` identity on the same `user_id`, orders 1. The
  linking mechanism this entry relied on is therefore observed, not assumed.
- **Two things this bought that are worth naming.** The email provider is
  disabled in the hosted project as well, so the removed path is closed at the
  API and not only in the UI. And Google's consent screen names the OAuth
  client's authorized domain, which is Supabase's: a customer reads
  "rvkecrwdohriruuulnzm.supabase.co" at the moment they decide whether to
  trust this product. Cosmetic, not a defect, and the only fix is a custom
  auth domain, which needs a domain the product does not own yet.
- **Revisit when:** a real customer without a usable Google account is turned
  away — that is the signal for a second provider, and it names which one; or
  Google's consent screen shows up as friction in real-usage numbers.

## 037 — comped access is its own column, and package deletion spares the receipt (2026-08-04)

- **Decision:** two things the operator asked for, built so that neither
  distorts what the product reports about itself.
  - **Comped access** (`packages.comped_at`, migration 008). An account on an
    allowlist gets packages that expose their full session count with **no
    order behind them and no 30-day window**. `effective_total_sessions`
    unlocks on `paid_at` **or** `comped_at`, because a session is a session;
    nothing that counts money reads `comped_at`. The allowlist is
    `COMP_ACCOUNT_IDS`, an environment variable holding Supabase user ids,
    comma separated. Unset grants nothing, there is no wildcard, and an
    anonymous package is never comped.
  - **Package deletion.** `POST /api/packages/{id}/delete`, owner-checked,
    running the same blobs-then-rows machinery as account deletion (025) so
    the two can never disagree about what a package contains. **Orders are not
    touched.**
- **Why a column instead of writing `paid_at`:** setting `paid_at` would have
  been one line and no migration, and it would have put revenue that never
  happened into the orders-and-paid view of the product — including
  `GET /api/metrics/usage`, whose output is published as the real-usage
  evidence this repo is partly built to produce. Impression rule ⑦ says
  self-test numbers are not real usage; the cheap version of this feature
  would have made that rule unenforceable by making a comp indistinguishable
  from a sale. The usage payload now carries `comped_packages_sampled` and a
  note naming the count, so a comped package is visible as what it is.
- **Why the receipt survives a package deletion:** an order is the record that
  money moved, and it stays true after the thing it paid for is gone. A
  customer may need it for a refund, a dispute, or an expense claim, and the
  operator needs the books to survive tidying up a test package. The order row
  is left pointing at a package id that no longer resolves, which is exactly
  what a receipt for a deleted thing is. Account deletion still removes orders,
  because there the customer is asking for everything about them to be gone.
- **Rejected — comping by fabricating an order row:** it keeps one code path
  and lies in the one table that is supposed to be the ground truth about
  money.
- **Rejected — an allowlist of email addresses:** this repository is public and
  the account that needs comping belongs to a private individual. A user id is
  already the key every other table uses and is not a contact detail.
- **Rejected — a typed confirmation for package deletion:** account deletion
  asks you to type your own address, which is proportionate for "delete
  everything". Asking for it to remove one of several packages is friction
  that teaches people to type past warnings. Two clicks, with the consequences
  stated at the second one, in the page rather than in a browser dialog.
- **Rejected — deleting a package that has an unused paid balance, silently:**
  not implemented either way today, and worth naming as unfinished. Deletion
  removes sessions and their recordings; if a paid package with sessions left
  is deleted, that entitlement is gone with it and nothing offers a refund.
  The operator is the only account with the button today, and comped packages
  have no money behind them.
- **Revisit when:** a second account needs comping and the allowlist starts
  wanting structure (a reason, an expiry, an audit trail); or a customer
  deletes a paid package with sessions remaining, which is the case above and
  needs an answer before this reaches many customers.

## 038 — the employer identity is one component, and the menus dismiss like menus (2026-08-05)

**Context.** F-54 put the company name and favicon on the /packages card, and
the operator's own screen immediately showed why that could not stay a
one-screen fact: two packages for the same role read identically everywhere
else — the top-bar switcher, /home's subtitle, /sessions, /progress, /rubric,
/checkout. Separately, both top-bar menus were native `details` elements, so
an open menu stayed open until its own button was clicked again, which no
menu a customer knows does.

- **Chosen — one decision module, one component, two variants.** Which
  identity a package shows is decided in exactly one place
  (`components/package-identity.ts`): the rubric's company name, trimmed, or
  nothing; the favicon mark only when `companyMarkHost` accepts the customer's
  own pasted JD URL — the same rule, the same code, as the F-54 card
  (`lib/company-mark.ts`). Pages render `PackageIdentity` and are forbidden by a
  wiring test from re-deriving either rule. Two variants because the seats
  differ: a CHIP pill beside page headings, and a bare row inside menus —
  measured against the tokens, not taste: CHIP's ground equals MENU_ROW's
  hover ground, so a chip inside a hovered row dissolves into it.
- **Chosen — light dismiss as a primitive over `details`, not a menu
  library.** `LightDismiss` renders the same server-renderable
  `details/summary` structure the bar already had and adds the missing
  behaviour while open: outside pointerdown closes, Escape closes and returns
  focus to the trigger. With JavaScript disabled it degrades to exactly
  today's click-to-toggle menu — the failure mode is the status quo, which is
  the property a login-wall product's chrome should have.
- **Rejected — the native Popover API:** it would remove the wrapper's
  listeners, but its no-JS state is "never opens" rather than "toggles", and
  anchor positioning for it is not yet dependable across the browsers this
  product supports. Revisit when baseline support makes the wrapper strictly
  deletable.
- **Rejected — rendering the identity ad hoc per page:** /rubric already had
  its own hand-written company line after two days, which is how one rule
  becomes five near-copies. That line is now the component too.
- **Accepted, documented:** two menus opened purely by keyboard can coexist
  until Escape or a pointer arrives (keyboard activation fires no
  pointerdown). That matches the previous baseline, where nothing closed
  them at all.
- **Revisit when:** a third consumer needs the popover to carry
  `aria-controls` through to the summary (the F-55 helper wanted it and
  shipped without), or the Popover API's baseline reaches this product's
  browser floor.

## 039 — a walkthrough that shows another product's screen without picturing it (2026-08-05)

**Context.** F-55: the LinkedIn PDF hint on /new ("open your profile, then
More > Save to PDF") tells, and the user asked for a helper that shows — a
speech-bubble walkthrough, step counter, an animation of what to click, in
the manner of first-visit product tours. Three references were researched
and are cited in the spec (`driver.js` for the footer grammar — counter
left, Back disabled rather than hidden, Next relabels to Done so the footer
never reflows; Shepherd.js for the beak carrying the bubble's own surface
and focus returning to the trigger; NN/g on instructional overlays for one
action per step and user-paced advancement).

- **Chosen — an abstract mock drawn in the product's own tokens,** naming
  LinkedIn's real labels ("More", "Save to PDF") as text, animated as a
  one-shot per step entry with a replay control, under the F-21 budget:
  0.3s-class segments, transform and opacity only, no loops; reduced motion
  gets the final frame plus the caption, losing nothing.
- **Chosen — non-modal, pull-only.** Nothing auto-opens it, no backdrop, no
  focus trap; the form underneath stays interactive and the field stays
  optional. Tab switches and window blur do not close it, because the reader
  is expected to spend a minute inside LinkedIn and must find the bubble on
  the same step when they return. Done closes and focuses the file input.
- **Rejected — real LinkedIn screenshots:** another company's trade dress
  committed to a public MIT repository, stale the next time LinkedIn moves a
  menu, and a localization trap. The text hint already carries the exact
  labels; the mock only has to carry the geometry.
- **Rejected — screenshots hosted behind the deploy:** solves the repo
  problem, keeps the staleness and the trade-dress question, and adds an
  asset pipeline for a decoration.
- **Rejected — a tour library:** driver.js and its peers assume they own the
  page (backdrop, scroll lock, global styles) to point at elements that are
  actually there. This walkthrough points at another product's screen; only
  the bubble grammar transfers, and that is copyable without the dependency.
- **Revisit when:** a second walkthrough target appears (the resume PDF field
  is the obvious candidate), at which point the step model and stage
  components generalize; or LinkedIn renames the menu, which the captions
  name and the mock must follow.

## 040 — the feedback door is a labeled mailto, not a form (2026-08-05)

**Context.** F-59: a Feedback entry in the footer row where the FAQ sits,
mechanism left open by the user. The footer already carried a support
address, but a support address is not a feedback door: customers report
breakage to support and keep opinions to themselves unless a label asks for
them.

- **Chosen — a labeled mailto beside the support one,** subject prefilled so
  the operator's inbox sorts it, no body template so the customer's first
  sentence is their own. Zero new data surface: nothing new to store, rate
  limit, or add to the deletion story, and it shipped the day it was asked
  for.
- **Rejected — a stored feedback form:** a table, an endpoint, an abuse
  surface and a deletion-story entry, built before a single customer has
  asked to leave feedback. Structure should be earned by volume.
- **Rejected — a third-party form:** the fastest structured option, and the
  first subprocessor on a privacy page that currently has none. Not for a
  footer link.
- **Revisit when:** real feedback arrives and starts wanting structure — a
  handful of mails with categories emerging, or a message that needed a
  reply loop the inbox could not give it.

## 041 — the signed-in product moves, inside the budget it already had (2026-08-05)

**Context.** The user read the product as too static. The research agreed and
located the gap precisely: every motion consumer sat on the marketing
surfaces while the signed-in tree had zero motion imports, and two
animations the F-21 spec had GRANTED were never built.

- **Chosen — build what was granted, then extend the vocabulary, not the
  budget.** The report score counts to its value once (the spec's own
  sentence: the number is the product's output and deserves one moment); the
  readiness gauge sweeps to its reading on first view; progress cards,
  session rows and the journey strip enter with the landing's existing
  vocabulary; a status that flips under a poll tick fades in, keyed on the
  status value. Everything one-shot, transform and opacity only, settled
  state under reduced motion.
- **Chosen — the count-up server-renders the final value.** A no-JS or
  pre-hydration reader sees the true score; the cost is that a hard load of
  a scored report shows the number, resets to zero at hydration, and counts
  once. No-JS honesty beats hiding the product's output to protect a
  flourish.
- **Chosen — the gauge sweep translates a right-anchored unit instead of
  scaling the fill.** An animated scaleX settles at a meaningful transform,
  and the no-JS backstop forces `transform: none` — which would render a
  full bar, a wrong number. The chosen shape settles at `none`, so the
  backstop and the animation agree about what the reading is.
- **Rejected — the press scale the F-21 spec granted** (`:active` scale
  0.98). The measured reference animates nothing on a control except colour,
  and the PRESS gesture was rebuilt to match it; adding the scale now would
  reintroduce exactly what the rebuild removed. It had been silently absent
  since then; this entry makes the absence a decision.
- **Dropped, recorded:** the /home stage-line fade (the line renders inside
  SessionTicket, outside the track's zone; the two-line change is written in
  the track report if wanted later) and the evidence-linked transcript,
  which is its own card.
- **Revisit when:** F-50 reopens the session room's motion question, or the
  demo video finds a surface that still reads static.

## 042 — AI crawlers are allowed on purpose, and the answers file stays honest (2026-08-05)

**Context.** F-60. GPTBot, ClaudeBot, PerplexityBot and their peers were
unaddressed in robots, which is default-allow by accident. A product that
wants to be found and quoted correctly should allow deliberately, and say
what may be quoted.

- **Chosen — named allow rules** for GPTBot, ClaudeBot, Claude-Web,
  PerplexityBot, Google-Extended, Applebot-Extended and CCBot, each carrying
  the identical public-route allows and the full disallow list. The names
  add no reach over the wildcard; they make the allowing legible as a
  decision. `/p/` stays disallowed for every agent, training crawlers
  included: capability links are customer data, not marketing.
- **Chosen — /llms.txt serves the product's facts,** every number an import
  (the price from the pricing constant, the refund window from policy), every
  claim one the live pages already make, including what the product is not:
  it never joins, listens to, or answers a real interview.
- **Chosen — /llms.txt stays out of the sitemap** (a convention file
  discovered at its own path, not a page to index) **and the Product JSON-LD
  carries no aggregateRating** (no real reviews exist; inventing them is a
  lie and a rich-results policy violation).
- **Rejected — blocking training crawlers:** the public pages are the
  product's own marketing, and being quoted correctly is the goal; customer
  surfaces are behind auth and `/p/` is disallowed, so the block would
  protect nothing that is not already protected.
- **Revisit when:** a crawler abuses the access, real reviews exist, or an
  engine publishes an llms.txt consumption contract worth conforming to.

## 043 — the judge authors its emphasis and its lists (2026-08-05)

**Context.** Since the design pass, the report emphasised each dimension
rationale's FIRST SENTENCE, by position — deliberately, because the product
does not decide which of a judge's words matter (F-48's card). And since 016,
each dimension's strengths and weaknesses shipped as empty fields under a
deterministic headline. Both were waiting for the same thing: the judge
saying it itself, validated at an eval gate.

- **Chosen — the judge marks its own span.** The content judge returns, per
  dimension, the one clause inside its own rationale that carries the
  finding, VERBATIM. The contract is enforced in code, twice: the content
  path resolves a whitespace-normalized match back to the exact
  character-for-character slice, and the report compiler drops any span that
  is not an exact substring of its rationale — for every channel, because
  DimensionScore is shared and the delivery path neither instructs nor
  verifies the field. A fabricated emphasis is worse than none in a product
  whose claim is that its verdicts are arguable.
- **Chosen — the judge authors the per-dimension lists, in the same call.**
  No second model call (the cost directive). The authored prose takes the
  same language lint as every free-text field the report ships.
- **Chosen — the headline stays deterministic.** Its 120-character ceiling,
  its lint, and its unconditional presence are compile-side guarantees; the
  judge's voice reaches the report through the spans and the lists.
- **Chosen — delivery-channel lists are dropped at compile, for now.** The
  delivery judge's schema advertises the fields but its prompt never
  instructs their register, and a volunteered inner-state item would fail
  the lint — which means failing the scoring run of a session that cannot
  be re-run. Uncontracted prose loses to a customer's session every time.
  The span survives on both channels (the guard holds it to the linted
  rationale). **Revisit: instruct the delivery judge's prompt, then delete
  the strip.**
- **Chosen — one emphasis rule, three renderers, and old reports outrank
  uniformity.** Screen, PDF and markdown all consume the same function with
  a source discriminator. In the fallback (no span), each format renders
  exactly what it rendered before the field existed — the screen keeps its
  first-sentence emphasis, PDF and markdown stay plain — because every
  stored report must render byte-identically, and that constraint beats
  making the three formats agree on a rule the judge did not write.
- **Rejected:** a second model call; a judge-authored headline; renderer-side
  whitespace or unicode normalization (the renderer runs raw indexOf on the
  stored string, because the scorer stores exact slices).
- **Revisit when:** the delivery judge gets instructed (delete the strip);
  or a gate run shows the enlarged response schema hurting discrimination,
  in which case the fields move to a follow-up call and the cost directive
  gets renegotiated instead of silently broken.

## 044 — the rubric shows its receipts instead of growing an edit button (2026-08-05)

**Context.** A production package compiled from a 108-character scrape-failed
JD ("Forward Deployed Product Manager … You need to enable JavaScript to run
this app.") came out as a seven-dimension rubric whose top-weighted content
dimension, at 0.20, was mission-and-ethics alignment — licensed entirely by
research citations, because the compiler's rules required citations from the
research findings or the corpus and never from the JD itself. The session
planner then guarantees every dimension at least one question, so a dimension
the JD never asked for bought a fixed share of a paying customer's twenty
minutes. No eval measured any of this: the discrimination suites test scoring,
not whether the bar mirrors the JD.

**Options considered.**
1. **Let the customer edit the compiled rubric** (the original F-61): rejected
   by the user on product grounds — the compiled bar IS the product, and
   outsourcing its correction to the customer weakens the claim while leaving
   the compiler broken.
2. **Ban the topic**: a lexicon that strips ethics-style dimensions at
   compile. Rejected — an AI-safety JD legitimately earns an ethics dimension
   at full weight, and a topic false-positive hard-fails a paying customer's
   compile.
3. **A JD-evidence contract, enforced in code, shown to the reader** — chosen.
   Every content dimension must carry `jd_evidence`, a verbatim quote (at most
   300 characters) from the job description proving the role itself demands
   the dimension; values boilerplate and research-only support cannot create a
   dimension (research corroborates, the JD licenses); delivery dimensions are
   licensed by the product and exempt, and capped at three so the channel
   label cannot become the dodge. /rubric renders each receipt under its
   dimension, and a new `rubric_faithfulness` suite joins the release gate.

**Enforcement home.** The verbatim check lives in the compile path, NOT in the
schema validator: `api/db.py` re-validates every stored rubric on every
package read, and every rubric stored before the field existed has no
evidence, so a validator rule would 500 the whole product's history. The field
is optional-with-default; compile is where the requirement bites, sharing the
compiler's single repair retry (total model attempts stay at two) so a
faithfulness failure gets the same one chance to self-correct as a schema
failure. The comparison string is the JD exactly as the model saw it —
truncated to the compile limit, then marker-neutralized — via the same public
helper the eval suite uses, so the two can never drift. The 300-character cap
is a code constant, not product.toml: it is calibrated against the eval, and
config invites turning a contract into a knob.

**Sharp edge accepted.** A delivery dimension that genuinely quotes the JD
keeps its quote (the compiler resolves-or-nulls it silently; the web renders
evidence when present, the product-licensed line otherwise). Coherent on both
sides: a JD that says "excellent verbal communication" earning a delivery
receipt is honesty, not leakage.

**Rejected at the edge.** Weight-proportional question allocation in the
planner: once unlicensed dimensions cannot exist, existence-buys-airtime
stops being the bug it was. Runtime topic lexicons anywhere in the path, per
option 2.

**Revisit when:** a licensed-but-marginal dimension still eats a
disproportionate share of session time (then weight-proportional allocation
becomes a card); the delivery-dimension cap of three proves wrong for a real
rubric; single-quote evidence proves too thin for dimensions that earn their
license across several JD lines; or the private few-shot rubrics are
refreshed with evidence-bearing examples and the disclaimer rule in the
prompt can be retired.

**Addendum, same day.** The first two real JDs through the contract each
failed their recompile on model re-typing habits, not on unfaithfulness: the
first capitalized the first word of a mid-sentence clause it quoted, the
second flattened a curly quote to ASCII. Both are systematic quoting
conventions, so the resolver gained two last-resort salvages after exact and
whitespace-normalized matching: case-insensitive, then a typographic fold
(curly quotes, en/em dashes, no-break spaces read as their ASCII forms).
Every fold mapping is one character to one character, so a match found in
folded space maps back to the same indices — what is stored and rendered is
always the JD's own character-for-character slice, casing, curly quotes and
all. Salvage, not fabrication. The eval suite's strict no-salvage machinery
check is unchanged on purpose; it measures the compiler's stored output,
which remains exact by construction.

## 045 — a dead session is refused at the mint, and the page owns the truth (2026-08-05)

**Context.** F-66, from the first real customer session: the session ended
"insufficient" fourteen seconds in, the room still offered Start, the
secret mint answered 200 on the retired row, and every heartbeat after it
answered 409 — which the connection guard could only read as network loss.
The customer saw "Connection lost" twice for a session the server had
already closed. The heartbeat route had a status guard; the mint route,
the actual door into the room, did not.

- **Chosen — the same guard at every door, and one screen owning the
  story.** The worker's mint route now refuses any session past "planned"
  (409, `session-not-live`, the heartbeat's exact shape) before the mint
  counter moves; the web route forwards that refusal with its code intact;
  the room page branches on the session status BEFORE the capability gate
  and renders an honest ended screen (what it ended as, that an
  insufficient or failed end kept the slot, a door home); and a stale tab
  whose mint comes back 409 simply reloads, so the server-rendered page —
  not a second client copy of the screen — decides what the customer
  reads. Resume was re-armed to match: handing back a retriable row now
  flips it to "planned", because "planned" is what every room guard means
  by "a browser may interview this", and a kept slot the room refuses to
  open is a promise the product cannot keep.
- **Rejected — a client-only fix** (branch on the fetched status, keep the
  server as it was): the server hole remains for every stale tab and every
  future surface; the exact class of bug this was.
- **Rejected — keying the client on error text:** copy changes would
  silently break the branch; the code is the contract.
- **Rejected — rendering the ended screen inside SessionRoom on the 409:**
  a second implementation of the same screen, fed by a snapshot that is
  stale by definition at the moment it matters.
- **Revisit when:** a second web surface starts minting secrets (the guard
  belongs in one shared place then), or a status beyond the current
  vocabulary needs the room to open (the fail-closed default would refuse
  it).

**Addendum, same day.** Review round 1 found the promise hollow on both
sides: resume never actually re-armed a row to "planned" (the fix above),
and two shipped doors — the archive row's "Retry" and the session page's
"Run this session again" — linked straight into the room, bypassing resume
entirely. Pre-F-66 those links "worked" by interviewing on a failed row
without resume accounting; post-F-66 they landed on the ended screen while
their labels promised a retry. The session page's CTA now performs the
resume action, and the archive shortcut is removed rather than relabeled —
the detail page it points to carries the honest door.

**Second addendum, same day (round 2: the fixes were the suspect).** Round
1's bare status flip handed the fresh attempt the dead attempt's evidence:
`secret_mints` and `last_heartbeat_at` survived, so for up to the whole
25-minute hard cut the re-armed row read as in-progress (a spurious
"session already in progress" refusal) or reclaimable (home's primary
button became "reclaim" for a room nobody was in) — and the durable mint
counter kept charging new attempts against the old attempt's spend, which
would have walked the incident row (3 of 5 mints burned) into a permanent
429 two retries later: the same dead-slot class F-66 exists to kill.
Re-arming is now `rearm_session`: status, `secret_mints = 0` and
`last_heartbeat_at = NULL` in one write, `updated_at` untouched (the F-38
lock opens at the next mint, not at the re-arm). The mint cap becomes a
per-attempt bound with total spend bounded by the resume cap (5 x 4
worst-case mints per row, versus 5) — accepted: the counter's documented
meaning, "a browser connected to THIS attempt", is what the liveness
guards read, and the abandoned re-arm had carried the same hazard since it
shipped. Round 2 also proved the first addendum's one-open-row claim false
— two open rows coexist when a row leaves "scoring" after a later one was
started, and resume takes the LOWEST — so the rerun CTA is offered only on
the lowest open session; a newer open session's page names the older one
("Finish session N first") and leads to its page instead of silently
entering its room.

**Third addendum, same day (verifying the round-2 fixes found two more).**
First: resetting the mint counter made the FREE abandoned resume an
uncapped loop — mint to the cap, let the heartbeat go stale, reclaim,
resume, repeat; roughly a hundred ephemeral secrets an hour on one row
against a durable five before. An abandoned resume is now a COUNTED
resume (quota.py): the row already ran an attempt, and the resume cap is
what bounds every loop. Cost accepted and recorded: a genuine crash's
reclaim burns one of the three resume attempts, where before it was free —
revisit if real crash-loop customers ever hit the cap. Second: the
"Finish session N first" door could hand out a link to an abandoned
session's page, and the web had never modeled "abandoned" at all —
deriveSessionDetailState returned undefined and the page THREW for any
abandoned session reached by URL, a pre-existing 500 the new CTA merely
made reachable. "abandoned" is now in the web's SessionStatus and reads as
insufficient everywhere it is rendered (detail state, archive pill,
trajectory column, home's resumable and attempted sets): ended before
there was anything to score, slot kept, resumable.

## 046 — the room measures before anyone tunes (2026-08-05)

**Context.** F-67 (the greeting moved on with no candidate turn — a
recurrence, on the first real session) and F-68 (a Start click that died
before minting, no trace in any log). The turn system was not casually
built — the reducer is the sole source of response.create and is
adversarially tested — so a blind fix would be a guess about which of three
different mechanisms (greeting instructions, VAD around the greeting, echo
path) actually misfired.

- **Chosen — a measure-only trail, always present, silent until opened.**
  A ring buffer (capacity 200) in a ref records the start sequence
  (getUserMedia begin/ok/fail with the DOMException name, resume outcome,
  recorder construction, mint and SDP statuses, channel open, greeting
  send) and every turn event (speech start/stop, commits with the
  echo-suppression verdict and its milliseconds, barge-ins, interviewer
  audio lifecycle, response triggers with their reason, guard trips, and
  heartbeat FAILURES only — a healthy beat four times a minute would evict
  the turn events the ring exists to keep, and the refused-heartbeat train
  was the incident's clearest server-side signal). It
  surfaces behind one collapsed "Diagnostics" disclosure on the live,
  error, upload-retry and connection-lost surfaces; the trail is formatted
  only in the toggle handler, so a customer who never opens it pays one
  summary row. Nothing is sent anywhere: the recorder writes a ref, and
  the six data-channel sends that existed before are still the only six.
- **Rejected — tuning first** (greeting instructions that wait, VAD
  thresholds for the greeting phase, echo-path suppression): three
  plausible fixes, one recorded reproduction pending; the evidence picks
  the fix, per the handoff's explicit measure-first order.
- **Rejected — an operator-only switch (query parameter or role):** more
  machinery to build and explain than a label that is honest product
  chrome, and the trail is exactly what a customer support conversation
  needs a customer to be able to read out.
- **Rejected — shipping the trail with the complete payload:** a schema
  and retention change for data whose reader is standing at the screen it
  already renders on.
- **Revisit when:** the open-speakers reproduction is recorded and the fix
  is chosen (the breadcrumb set may then shrink to what proved useful), or
  a customer-facing incident needs the trail server-side (then the
  complete-payload option earns its schema).

## 047 — Morgan improves by loop, and the loop's bar is a public artifact (2026-08-07)

**Context.** F-69. The operator compared Morgan with ChatGPT Advanced
Voice Mode on the same underlying realtime model family and found AVM
markedly more natural — fillers, pacing, the feel of turn-taking. The gap
lives in levers outside the model (the instructions' speech-style
contract, turn policy, voice and output settings, audio chain). The
operator's directive: close it with an eval-driven loop, not one-off
prompt fiddling, and make defining the bar itself a recorded, public part
of the work.

- **Chosen — a measured loop with a hybrid runner, report-only until the
  bar earns trust.** An operational bar (`evals/suites/morgan_naturalness/
  bar.md`, every axis carrying definition, exact metric, band and status)
  plus a worklog of the discussions that produced it; a fixed case set of
  5 to 10 recordings (frozen Morgan baselines as the trend line, one or
  two fresh short sessions per lever change, operator-recorded AVM
  references with one held out); Python precomputes every number that
  requires listening (`scorer-morgan-metrics`, reusing the delivery DSP
  with inverted speaker labels plus native turn metrics), and Evalite —
  the vitest-based TypeScript eval runner — is the loop cockpit in
  apps/web, reading precomputed JSON and comparing against
  `bar.thresholds.json`. One lever, one run, one worklog entry, one
  committed report per cycle. The suite gates nothing until the bar has
  survived several cycles unchanged.
- **Rejected — tuning by ear:** the exact practice the loop replaces; a
  second person cannot verify an ear.
- **Rejected — one eval stack (extend scorer-evals only):** fewer moving
  parts, but the loop cockpit belongs where the iteration happens and
  where watch-mode ergonomics exist; the seam is honest — anything that
  must LISTEN stays in Python, the TS side reads numbers.
- **Rejected — automated prompt optimization first (DSPy and kin):** an
  optimizer pointed at an unvalidated bar optimizes the wrong thing
  faster; revisit after at least two manual cycles.
- **Rejected — gating releases on the new suite now:** R1 cuts scope, not
  quality, and a placeholder band as a release gate is fake quality.
  Promote to the gate only when the bar stops moving.
- **Boundary decided with it:** turn-system levers (VAD parameters,
  client response policy) stay behind F-67's measure-first process
  (DECISIONS 046). The loop may produce evidence that implicates them —
  filed to F-67 through the worklog — and never tunes around them.
- **Revisit when:** the bar survives three consecutive cycles unchanged
  (promote to release gate); recordings become the iteration bottleneck
  (build the headless scripted-session harness on realtime_probe); or two
  manual cycles complete (consider optimizer-assisted lever search).

## 048 — The feedback door grows structure: stored ratings and an operator inbox (2026-08-08)

**Context.** F-71. DECISIONS 040 shipped feedback as a labelled mailto and
named its own revisit condition: structure gets built when real feedback
asks for it. The operator has now asked for it directly — a rating plus
free text, stored, with an in-app place to read and manage what arrives.
The reference product the operator studied (a Korean AI phone-English
app) does exactly this as a post-call modal: five stars and a textarea.

- **Chosen — a `feedback` table, a worker router, and an operator-only
  inbox at `/ops/feedback`.** Rating stored as a half-star count
  (`rating_half_stars`, integer 1–10): the 0.5 granularity becomes a
  database CHECK constraint instead of a float-equality convention.
  Rating required, text optional — a silent two-star is still signal.
  Signed-in only; the user id comes from the session, never the request
  body. Fixed-window rate limit plus an absolute per-user cap plus a
  body-size cap, because a free-text POST is an abuse surface. Statuses
  `new → seen → archived`. The submitter's stored id is shown in the
  inbox; no email address enters the table. Feedback text is untrusted
  input: rendered escaped, never fed to any model.
- **Chosen — operator identity is `OPERATOR_USER_ID`, an env-supplied
  Supabase user id checked in the Next layer, failing closed.** The
  house already solved "one known operator, no role system" this way
  (comp accounts): an id is the key every other table uses and is not a
  contact detail; unset means nobody is operator. Not added to the
  required-env list — a deploy without it must succeed with the inbox
  off, not fail. The inbox route 404s for everyone else and is linked
  from nowhere.
- **Rejected — email-matched operator:** aliases, case, domain variants,
  and the operator changing addresses all break it quietly; the id
  cannot drift.
- **Rejected — a worker-side role system:** one operator does not need
  an authorization framework; the web layer is already the identity
  seam for every other user-facing read.
- **Rejected — anonymous submissions:** attribution is what makes
  feedback actionable at this scale, and the abuse story of an
  unauthenticated write endpoint is a poor trade for one door.
- **Revisit when:** feedback needs replies (then statuses grow a loop
  and the table a thread), or a second operator exists (then the env
  var becomes a list or a real role).

## 049 — Post-session coaching: verdicts, stronger phrasings, and the customer's marks (2026-08-08)

**Context.** F-73. The operator wants what the reference app does after a
call, adapted to interviews: every answer in the transcript carries a
verdict mark (strong, or needs work), opening it shows a stronger
phrasing of the whole answer with a why that names specific word
choices, and each suggestion can be bookmarked and rated up or down —
the marks stored, because they are the raw material for judging the
coaching itself later.

- **Chosen — three new columns on `sessions`, one artifact each.**
  `paraphrases` (generated: per candidate turn, a verdict
  good-or-improve, a verbatim source anchor, a full-turn rewrite, a
  why), `insights` (generated: this session's did-well, did-poorly,
  must-keep expressions, must-answer questions with model answers), and
  `paraphrase_marks` (the customer's state: reaction and bookmark per
  turn). Columns rather than tables because the transcript already
  proved the pattern: they ride session deletion for free, and they are
  excluded from the hot-read column list so no poll ever carries them.
  Generated state and user state stay in separate columns — a
  regeneration must never wipe a bookmark.
- **Chosen — keying by candidate-turn ordinal over a shared grouping
  rule, pinned across languages.** The transcript is a positional
  segment array; the web merges consecutive same-speaker segments into
  turns before rendering. The Python side now mirrors that rule
  (`scorer/turns.py`), and a committed golden-vector fixture with twin
  test gates (one per language) fails if either side's grouping drifts.
  The stored artifact also records the candidate-turn count it saw — a
  reader that derives a different count renders no coaching rather than
  misaligned coaching.
- **Chosen — generated inside the scoring job, immediately after the
  report is saved, each artifact in its own try/except.** The report is
  already visible when coaching starts; a coaching failure is a log
  line, never a scoring failure, and deliberately not a dead-letter —
  the run succeeded. Scored and limited sessions only: the eligibility
  gate's whole posture is that below the floor, no model spend, and
  coaching built on refused evidence would be advice the product does
  not stand behind. The reference app draws the same line.
- **Chosen — the verbatim contract extends, not bends.** Suggestions
  and model answers are generated text, labelled as such everywhere
  they render. The only verbatim fields are the anchors, located with
  the same span machinery the report uses; an anchor that cannot be
  located drops its item rather than shipping a misquote.
- **Rejected — fields on SessionReport:** the report schema is
  extra="forbid" with a tested verbatim contract; coaching is a
  different artifact with a different truth standard.
- **Rejected — on-demand generation:** puts model latency in front of
  the first transcript view and needs concurrent-generation dedup, to
  save roughly a cent per session.
- **Rejected — per-turn model calls:** ten to twenty requests repeating
  the same rules for the tokens one batched call carries.
- **Revisit when:** the marks accumulate enough volume to analyse
  (they become an eval input for coaching quality), or old sessions
  deserve a backfill pass, or the insufficient-session line draws real
  customer complaints.

## 050 — Study materials: a package-level table, built on demand, stale by set-difference (2026-08-08)

**Context.** F-74. The operator wants a Study tab: bookmarked expressions
organized by session, plus a package-level summary — recurring problems,
an improvement strategy, the job's core questions with model answers to
memorize — exportable as Markdown and PDF.

- **Chosen — a `study_materials` table whose primary key IS the package
  id.** Every package read in the data layer is `select("*")`; a
  30–60 KB document as a packages column would ride every home and
  progress poll — the exact size class the transcript column was
  engineered out of hot reads for. One row per package by primary key;
  package deletion sweeps it.
- **Chosen — built on demand, 202-plus-poll, stale by set-difference.**
  Generation is a button, not a side effect of scoring: model spend
  happens when the customer asks for the artifact. The stored document
  records exactly which scored sessions it consumed; staleness is a
  set comparison at read time, so a deleted session reads stale too.
  A failed or in-flight regeneration keeps the last good document, and
  a generation stuck longer than the configured window reads as failed
  at GET time — no new reaper machinery. Regeneration is allowed even
  when fresh (rate-limited); generation is refused on expired packages
  while reads stay open, matching the standing rule that reports and
  replays outlive the window.
- **Chosen — the bookmark view is a join, not a generation.** Saved
  expressions organized by session come from joining the coaching
  artifacts with the customer's marks server-side at read time.
  Generating a copy would go stale the moment the customer bookmarks
  one more card.
- **Rejected — a packages column:** hot-read weight, and a wide shared
  refactor to avoid it that three parallel tracks would collide on.
- **Rejected — regenerating on every scored session:** spend without a
  reader; the stale banner plus a button is the honest version.
- **Revisit when:** generation cost or latency makes precomputation
  worth it, or the export grows an audience beyond the customer (then
  the capability-token rules apply to it).

## 051 — The measurement stack gets a version stamp, a golden clip, and one less lucky duplicate (2026-08-08)

**Context.** F-70. An outside comment the operator relayed: voice-activity
detection is a hidden source of evaluator-side drift — change the VAD
model or its thresholds and talk-time ratios move even when the audio and
transcript are identical, so version the VAD like code and pin its output
on golden audio. The comment's principle is right and its mapping onto
this repo needed correcting first: the evaluation path has no standalone
VAD model — segmentation comes from the transcription model plus DSP
constants — and the OpenAI server-VAD in the interview room is part of
the system under test, a lever, never the evaluator.

- **Chosen — a `measurement` provenance block in every Morgan metrics
  document:** the transcription model id in force, the DSP constants
  version, the interruption overlap floor, and whether the transcript
  came from cache or a fresh transcription. Two reports that disagree
  now carry the evidence of whether the ruler moved.
- **Chosen — a committed synthetic golden clip with expected
  segmentation:** a generated voice clip (no privacy surface) whose
  expected segment boundaries and total speech time are committed with
  tolerances; re-run when transcription configuration changes, it
  answers "did the ruler move" directly.
- **Chosen — the lucky duplicate gets a gate.** `silence_duration_ms`
  exists in three places (web room literals, product config, the
  webroom harness) with nothing comparing them; the session-timing SSOT
  twin-gate pattern extends to the VAD tail and the interviewer model
  id. The repo's own contract file called this open work; it stops
  being open.
- **Chosen — `lever_state` in the naturalness suite becomes structured:**
  the instructions commit and the VAD parameters a recording was made
  under, so system-side versions are locked with the same discipline as
  evaluator-side ones.
- **Rejected — pinning the room's VAD parameters as evaluator config:**
  that mixes the lever with the ruler and would quietly bypass the
  F-67 boundary (DECISIONS 046) that keeps turn-system tuning behind
  recorded evidence.
- **Revisit when:** the transcription provider stops honouring pinned
  model ids (then the golden clip becomes a scheduled canary rather
  than a config-change check), or bar Round 1 finds the stamp is
  missing a field it needed.
