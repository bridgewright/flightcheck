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
  step in integration rather than a recurring surprise. (Count updated
  2026-08-13: at least seven — three more in the v0.14 batches, still
  caught at cherry-pick every time. The revisit condition below has not
  fired, but the rate is now roughly one incident per batch.)
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

## 052 — A long answer is not a dead connection (2026-08-08)

**Context.** Hotfix, from a live field kill — the operator in the
customer seat, as throughout this cycle:
sessions died with "Connection lost" at exactly 20 seconds into the
first substantial answer, every time. The full diagnostics trail named
it — `49.8s cand-start`, then silence, then `70.3s guard-trip
starvation` — the operator-as-customer was still talking when the
guard ended the session. F-17's starvation detector counted candidate-audible seconds
with no data-channel traffic as evidence of a dead transport, but
server VAD speaks only at speech boundaries: a candidate mid-answer
legitimately produces zero traffic, so the guard's expectation was
wrong by design, and interview answers routinely outlive the trip
window.

- **Chosen — candidate speech expects nothing.** The starvation
  accumulator now runs only while the interviewer is audible (his audio
  streams transcript deltas over the channel) or a response is owed. A
  genuinely dead transport is still caught four ways: ice-failed,
  channel-closed, ice-disconnected, and starvation the moment a
  response is requested. Pinned by a test that runs a 400-second
  answer through the guard and requires zero accumulation.
- **Rejected — lengthening the trip window:** any window loses to a
  longer answer; the failure was the expectation, not the number.
- **Rejected — client-side keepalive pings:** the client cannot force
  the server to produce traffic, so a ping proves only the client's
  own half of the channel.
- **Also fixed in the same incident:** the Permissions-Policy
  microphone grant is global now (`microphone=(self)`) — the per-path
  room exception never governed the document under client-side
  navigation, so first entries failed as "blocked" until a refresh
  (the SPA lesson is recorded in lib/security-headers.ts and pinned by
  test); and the Diagnostics disclosure opens scrolled to its newest
  entries, because the scroll box hiding the trail's tail cost this
  incident a debugging round.
- **Evidence filed to F-67:** the same trail shows a real first answer
  purged as echo (`commit-echo-suppressed 1066ms`, open speakers) —
  the echo-outlive floor swallowed genuine speech once. Logged for the
  F-67 evidence pile, not tuned here.
- **Revisit when:** the transport gains a real server keepalive (then
  starvation can watch it), or F-50 rebuilds the room's connection
  layer.

## 053 — Study lives inside the session; the package guide retires (2026-08-08)

**Context.** First two-session use of the v0.12 surfaces — the
operator in the customer seat, with session two a SYNTHETIC insert the
operator requested so the two-session surfaces would light up (marked
never-to-count for usage metrics; amended same day for precision). The
customer's verdict on the Study tab reversed 050's shape: study
material belongs inside each session, a session should open on the
conversation itself rather than a verdict, and nothing a customer
studies should sit behind a Generate button ("run in the background
and keep it filled" — and the chosen design goes one better: there is
nothing left to run).

- **Chosen — session-first, derived at read time.** The global /study
  tab, its Generate flow, and the package-level guide are removed. The
  session detail page opens on the Transcript tab; the verdict and
  report keep their own tab. Bookmarking a coaching suggestion builds
  the session's study notes: each saved item is rendered as an
  interviewer-question + answer set (question, better answer, what you
  said, why), joined by the session's core questions with model
  answers, exported per session as Markdown or PDF in plain Q&A form —
  a wrong-answer notebook to memorize from. Everything derives from
  coaching artifacts already generated at scoring time plus the user's
  own marks, so the tab is always current by construction: no build
  step, no staleness, no per-session regeneration.
- **Rejected — keeping both surfaces:** two doors to the same
  material, and the global door led with status chrome the customer
  explicitly did not want.
- **Rejected — auto-generating the package guide in the background
  after each scoring:** satisfies "always filled" literally, but keeps
  a second document whose only unique content (the package summary)
  lost its reader; recurring generation cost with no surface.
- **Left dormant, deliberately:** the scorer's package-study endpoints
  and `study_materials` table stay in place unused — removing them
  churns a tested API surface for no product gain. Revisit when a
  cross-session aggregation view is asked for again (the
  bookmarks-by-session join already exists server-side), or after two
  releases of disuse (then strip).

## 054 — Rubric trends are lines, not bars (2026-08-08)

**Context.** Same session of field feedback (the operator in the
customer seat): the dashboard's
overall-trend bars "overlap and are completely unreadable." Root
cause: `OverallTrend` rendered fixed-width flex pills with no shrink
guard, so a narrow column collapsed them into each other. The customer
asked for line charts everywhere a rubric trend appears, a much taller
overall chart, all six package sessions visible as slots, and pastel
accents beyond the ivory/brown core.

- **Chosen — one hand-rolled SVG line component, two variants.** Hero
  (overall score): tall, airy, x-axis spans every package slot S1..S6
  so future sessions are visibly waiting, scored sessions plotted as
  the line; spark (per-dimension table rows): small inline lines with
  a shared x-domain. Line stroke is the existing pastel `sky` token
  (its first use in app chrome), dots in ink, latest point emphasized
  with its score printed. Geometry lives in a JSX-free module with
  unit tests.
- **Rejected — fixing the flex-shrink bug and keeping bars:** the ask
  was trajectory ("am I getting better"), and a line answers it
  directly; bars at 6 sessions × 8 dimensions stay a density
  instrument even when they stop overlapping.
- **Rejected — a chart library:** one dependency for two variants of
  one chart; hand-rolled SVG keeps the token-only color rule
  enforceable by the existing scans.
- **Revisit when:** packages exceed ~8 sessions or a multi-package
  comparison view appears — then a library earns its keep.
- **Amended same day, from adversarial review:** measured contrast
  killed the pastel STROKE — sky on paper is 1.26:1, below the
  hairline grid's own 1.23:1 "decorative only" rating, so a sky line
  was indistinguishable from the rules behind it. The line is drawn in
  ink-muted (5.95:1) and the pastel moved to an area wash under it,
  which is the role a pastel can actually carry. Second review-driven
  change: all chart text and dots render as HTML positioned over a
  graphics-only stretched SVG, because viewBox-scaled SVG text hit
  ~6 px on phones. Accepted knowingly: the sky area occludes grid
  lines inside the fill (ordinary area-chart behavior), and chart
  slopes vary with viewport aspect (inherent to responsive stretch;
  strokes stay uniform via non-scaling-stroke).

## 055 — The answer-end gap loses 0.6 seconds, at the debounce, not the VAD (2026-08-08)

**Context.** Second live session (the operator in the customer seat,
as throughout this cycle): the customer reports the interviewer
waits noticeably too long after an answer ends. The wait decomposes as
~900 ms server-VAD tail + up to 250 ms tick quantization + 1,200 ms
client response debounce + up to 250 ms quantization, roughly 2.1 to
2.4 s before `response.create` even fires. The generous patience was
deliberate (hesitant non-native speakers, DECISIONS 009/011); the
field verdict is that it overshoots. DECISIONS 009's revisit condition
named exactly this report, so this is the documented unblock, not a
silent tuning.

- **Chosen — `RESPONSE_DEBOUNCE_S` 1.2 → 0.6.** A 0.6 s cut, inside
  the 0.5-0.7 s the customer asked for. The debounce keeps existing:
  0.6 s still catches a resumed sentence after a premature VAD commit,
  on top of the acoustic layer's own 900 ms of required quiet
  (total quiet before the interviewer speaks: ~1.5 s, down from ~2.1).
- **Rejected — shortening `silence_duration_ms` (900):** that is the
  acoustic hesitation guard; the echo-suppression floor
  (`ECHO_OUTLIVE_MS = 2400`) is derived from it; and it is one of the
  F-67-blocked levers awaiting recorded evidence. The latency budget
  had a cheaper, safer line item.
- **Rejected — shrinking the 250 ms ticker:** saves at most ~0.25 s
  average, and the tick quantum also paces the connection guard and
  silence ladder; retiming three instruments to speed up one is bad
  surgery.
- **Eval note:** the naturalness suite has not frozen baselines yet
  (blocked on operator recordings), so this response-policy change
  lands BEFORE round 1 measurements and poisons nothing; it must be
  named in the suite worklog and in `lever_state` going forward.
- **Revisit when:** field sessions show premature interviewer starts
  over resumed answers (then 0.6 was too tight), or F-67's evidence
  unblocks acoustic-layer tuning.

## 056 — The interviewer's goodbye ends the session (2026-08-08)

**Context.** Same session: after the closing line ("That's everything
from my side…"), the room kept running — the silence ladder, which
cannot know the interview is over, nudged "Take your time." into a
finished interview, and the session sat open until the manual button
or the 25:00 hard cut. The closing phase exists only as a sentence in
the interviewer's instructions; no plan cursor reaches the browser.

- **Chosen — transcript-sentinel auto-end with an arming window.** The
  room already receives the interviewer's speech transcripts
  (`response.output_audio_transcript.done`) and already knows when his
  audio finishes playing (`output_audio_buffer.stopped`). The planner
  pins the exact closing line; the web matches its tail ("good luck
  out there") in transcripts, armed only inside the wrap-up window
  (elapsed ≥ budget − 2 min). On detection: the silence ladder and
  response debounce shut off immediately (no more nudges, ever), and
  once the interviewer is quiet and the room stays fully quiet for a
  short linger (the candidate may say goodbye — their speech defers
  the end), the session ends through the NORMAL completion path:
  recorder stop, upload, complete, scoring, redirect to the report.
  The closing sentence is a cross-language contract now: twin SSOT
  tests pin the web marker as a substring of the planner's line.
- **Failure posture:** a missed detection (model paraphrased the
  goodbye) degrades to exactly today's behavior — manual end or hard
  cut still work; nothing new can strand a session. A false positive
  is fenced by the arming window plus the hardened instruction that
  the closing line is the final sentence, spoken word for word.
- **Rejected — an end_interview function/tool call:** the more
  machine-honest signal, but it adds a tool surface to the minted
  session and a new event family to the room for a case the sentinel
  covers with benign failure.
- **Revisit when:** field trails show missed closings (the model
  paraphrased past the sentinel — then the tool call earns its
  surface), or a session ends early against the customer's intent
  (then the arming window or the linger was wrong).
- **Rejected — shipping the plan cursor to the browser:** the plan is
  deliberately stripped from client responses (question bank
  confidentiality); a closing bit alone does not justify reopening
  that boundary.
- **Eligibility note:** closing normally fires at ≥18 min, far above
  the 10-minute scoring floor; an interviewer who somehow closes
  earlier produces the same insufficient outcome a manual early end
  would — unchanged policy.

## 057 — Coaching interaction, second field pass: inline cards, and a flag instead of thumbs (2026-08-08)

**Context.** The customer used the shipped coaching surface within hours
and corrected two interaction choices. The popup card (F-77's dialog)
reads as a context switch — "the green and red should open DOWNWARD in
place"; and the thumbs up/down pair next to bookmark is both unclear in
its pressed state and less useful than what they actually want to tell
us: WHAT went wrong with a suggestion.

- **Chosen — inline accordion card.** The check chip toggles a card
  that expands directly under the answer bubble (content order
  unchanged: better answer, why, what you said). The dialog is
  removed. This revisits the popup half of F-77's design; the
  reference app uses an overlay, but the customer read our version as
  a new window, and an in-flow expansion keeps the transcript's
  reading position.
- **Chosen — marks become bookmark + flag.** Thumbs up/down retire
  from the UI (stored reactions keep their column shape; no data is
  destroyed and old rows stay valid). A flag control opens a
  structured error report: misheard speech, inappropriate content,
  inaccurate paraphrase, missing explanation, or other with free
  text. This is a sharper training/eval signal than a bare thumb —
  each flag names the failure mode, which is exactly what the
  coaching-quality eval (049's stated purpose for marks) needs.
  Pressed states get an unmistakable treatment (washed chip ground +
  filled icon), because the customer could not tell a pressed icon
  from an idle one.
- **Rejected — free-text-only feedback:** unstructured text cannot be
  counted; the enumerated reasons make the flag data aggregable and
  the "other" branch keeps the escape hatch.
- **Also in this pass, recorded as defect fixes, not decisions:** the
  replay strip never worked in production — `media-src 'self' blob:`
  blocked the storage origin the signed URLs live on, so the browser
  never issued the fetch (storage logs: sign 200s, zero byte reads,
  ever); the pastel trend area gains translucency so the grid reads
  through it (revisits 054's occlusion note by customer direction);
  and the session sub-tabs return to Report first with Report as the
  default — the customer's own click path is the sessions list's
  "Report" affordance, and landing it on Transcript contradicted the
  label (revisits the transcript-first half of 053 by the same voice
  that asked for it).
- **Revisit when:** flag volume is large enough to rank failure modes
  (then the enumerated reasons get re-derived from the data instead of
  from this guess), or the inline card proves too tall on small
  screens (then the popup question reopens with measurements), or a
  second interaction reversal lands on this surface inside a release
  (then stop iterating live and run a proper design pass).

## 058 — Sessions stop repeating: variety from the bank, aim from the history (2026-08-08)

**Context.** The product one-liner promises repeat sessions with fresh
topics until the candidate can pass; every session has run the identical
baseline plan since v0.1, and the repo says so honestly in four enforced
places (the PRD note, README, the landing copy register's FORBIDDEN
"fresh topic" entry, llms.txt). The material to fix it already exists
and is discarded: the compiler builds a question bank the planner
truncates to one question per dimension — a test even pins the second
bank entry as "must not be picked" — and prior sessions' plans and
reports are in hand at plan time with no new query.

- **Chosen — deterministic variety, pure function of (rubric, index,
  history).** `plan_baseline_session` grows keyword-defaulted
  parameters (existing call sites and ~15 test fixtures keep working):
  per dimension, the question rotates through that dimension's bank
  entries, skipping any question text a prior session's stored plan
  already asked; the compiler is asked for 2-4 bank entries per content
  dimension so the bank can carry six sessions; the pressure probe
  rotates through a small set and targets the WEAKEST scored content
  dimension from history (heaviest-weight fallback for session 1); from
  session 2 with scored history, the question sequence orders weakest
  dimensions first and `focus` widens to "targeted" (schema Literal
  widened additively; web mirror follows). No model call, no
  randomness, no clock — same inputs, same plan, exactly as the module
  contract already demands.
- **Rejected — generating fresh questions per session with a model
  call:** cost and nondeterminism at session-start, a new injection
  surface, and the bank already carries research-grounded material the
  planner throws away today. Revisit if six sessions exhaust a thin
  bank in practice.
- **Rejected — mining prior transcripts for asked topics (v1):**
  transcript reads are deliberately excluded from the list projection
  (25-60KB per row); the stored plans' question texts are sufficient to
  avoid verbatim repeats.
- **Unchanged on purpose:** re-armed sessions keep their stored plan;
  the closing line stays a single literal (the SSOT twins depend on
  it); the honesty copy flips to "fresh topics" IN THE SAME RELEASE
  that ships this, never before.
- **Revisit when:** real packages show the bank exhausted before
  session 6 (then compiler breadth grows), or targeted ordering makes
  sessions feel repetitively remedial (then cap how many weakest-first
  slots lead the sequence).

## 059 — The rubric learns who is sitting in the chair (2026-08-08)

**Context.** Real interviews probe the person, not just the role: why
this company and not its obvious rival, why product after consulting.
The product already ingests a resume and LinkedIn PDF, distills a
structured CandidateProfile (raw documents deliberately not stored),
and shows it to the rubric compiler as background only — the rules
forbid anything but the JD from licensing a dimension, and the
faithfulness gate enforces JD evidence on every content dimension.

- **Chosen — a profile-licensed fit dimension, with its own honest
  receipt.** `RubricDimension` gains `license: "jd" | "profile"`
  (optional, default "jd" — stored rubrics revalidate unchanged, the
  jd_evidence precedent). When and only when a non-minimal profile
  exists, the compiler adds at most ONE content dimension,
  role-and-company-fit (motivation, the career story, why this
  company), licensed by the profile with `jd_evidence` null; the
  faithfulness check exempts profile-licensed dimensions from JD
  evidence while still refusing them any JD-boilerplate license. The
  rubric screen renders a third receipt branch ("this bar comes from
  your own profile") so the dimension never sits silently unreceipted
  next to quoted ones. Every downstream surface — scoring split,
  report, coaching, study, trends — is dimension-list-driven and picks
  it up unmodified; one more content dimension costs three more judge
  calls per scored session, accepted.
- **Chosen — fit questions are templated from the structured profile,
  not generated.** The planner mines CandidateProfile deterministically
  (career pivot: latest roles vs the JD's role family; company choice:
  the JD's company) into one or two personal questions folded into the
  058 rotation, so repeat sessions challenge different biography
  angles. Pure, testable, no new model call at session start.
- **Eval posture:** the faithfulness suite compiles its fixtures with
  an empty profile by design, so existing fixtures and the 1.0 gate
  are untouched; a NEW fixture with a profile pins the other side —
  fit dimension present, profile-licensed, and forbidden from
  swallowing JD-licensed dimensions. The feature ships eval-gated from
  day one.
- **Rejected — persisting raw profile documents for richer mining:**
  a privacy surface (full resume text at rest) for marginal v1 gain
  over the structured fields; revisit when templated questions feel
  thin in real sessions.
- **Rejected — a third scoring channel for fit:** content-channel
  judging from the transcript already fits; a channel is a scoring
  mechanism, not a topic.
- **Revisit when:** flag/feedback data shows fit questions reading as
  generic (then raw-text persistence reopens with a privacy design),
  or the fit dimension's scores prove noisier than its siblings (then
  its verdict weight gets its own look).

## 060 — The quick interview replaces the trial session (2026-08-09)

**Context.** The current first-touch asks a visitor to hunt down a full
job description, paste it, and sit a 20-minute session before they know
whether the product is for them — and the free tier (F-24: first
package carries one full scored session) gives away the most expensive
thing the product makes. User direction (2026-08-08, refined
2026-08-09): the front door becomes a five-minute quick interview from
just a company name and a role title, and it REPLACES the free full
session — one free door, not two.

- **Chosen — quick interview as the only free tier.** A visitor types
  a target company and role (no JD), signs in, and talks to the
  interviewer for about five minutes. Questions are templated from the
  company and role alone, labeled ungrounded — no research pass, no
  rubric, honestly distinct from the paid JD-grounded interview. Five
  minutes sits below the scoring eligibility floor, so the quick
  session is never scored and never pretends to be: the post-session
  screen renders the existing public sample report inside a frame
  carrying the visitor's company and role, under a banner saying
  plainly that this is a sample and a real package personalizes all of
  it (user's own design — the quick result is not processed at all,
  which also keeps the quick path at zero model cost). Registering the
  real JD stays free up to the rubric — the "this is the bar" moment —
  and every full 20-minute scored session is paid. Historical
  `is_trial` rows keep their data; the flag is simply never granted
  again, and the trial copy retires across landing, pricing, FAQ,
  terms, and llms.txt in the same release.
- **Rejected — coexist (quick taste AND a free full session):** two
  free doors double the free realtime cost per account, and the pitch
  collapses — nobody pays for what the trial gives away whole. The
  trial's conversion value was never measured (no external users yet),
  so nothing proven is being discarded.
- **Rejected — no free voice at all (sample report only):** the core
  claim of the product is the live voice experience; a text artifact
  cannot carry it.
- **Rejected — processing the quick session into a real teaser
  verdict:** scoring five minutes fairly is exactly what the eligibility
  floor says cannot be done, and a "lite verdict" would be the first
  dishonest number in the product.
- **Abuse posture:** quick sessions cost realtime-API money per
  minute, so OAuth stays in front of the quick interview and each
  account gets a small lifetime allowance of quick packages (config
  cap, second slot exists for technical do-overs), on top of the
  existing create limiters.
- **Revisit when:** real-usage data shows registered accounts piling
  up at the rubric wall without paying (then a priced single-session
  step reopens), or quick-interview abandonment shows five minutes is
  the wrong length.
- **Amendment (2026-08-10, review round):** a reviewer proved the
  lifetime allowance was fiction — deleting a quick package and
  creating another reset the count, so the cap was a delete button
  away from unlimited free realtime minutes. Per-package deletion of a
  quick row is now refused (after ownership is proven, so nothing is
  disclosed to strangers); account deletion still removes everything,
  which keeps the privacy right whole and honestly resets the
  allowance at the price of every paid package and receipt. Quick
  packages never appear on the packages overview, so no customer
  meets the refusal in normal use. Rejected: absorbing the hole for a
  cleaner surface — a bound that private deletion can reopen is not a
  bound.

## 061 — The home screen introduces itself, once (2026-08-09)

**Context.** After the quick interview a new account lands on a home
screen it has never seen, built around surfaces (sessions, progress,
rubric) it has not earned yet. User direction (2026-08-09): on the
first arrival, dim the screen and walk the features one by one —
"press this for X" — the classic coach-marks pattern. This is the
product's first auto-opening surface, a deliberate breach of the
pull-not-push convention the LinkedIn walkthrough header records; the
breach is the point (a first-time visitor does not know what they do
not know) and it is bounded: once ever, skippable at every step.

- **Chosen — first-ever home arrival, localStorage once-flag.** The
  tour fires when the flag is absent and never again after completion
  OR skip. "First arrival after the quick test" (the user's phrasing)
  is satisfied as a superset: in the new funnel the first home arrival
  IS the post-test arrival, and accounts that skip the quick path get
  the same one-time introduction. Per-browser is the honest
  limitation — a new device re-shows the tour once, which is the
  cheap failure direction.
- **Rejected — a ?tour=1 route param:** re-fires on bookmarked or
  shared URLs and vanishes on navigation (the rubric `?reveal=1`
  lesson).
- **Rejected — a server-side user-metadata flag:** a server write and
  a new metadata surface for a cosmetic, per-browser-acceptable flag.
- **Rejected — pull-only "?" trigger like the LinkedIn walkthrough:**
  explicitly what the user asked to go beyond; a trigger nobody knows
  to press introduces nothing.
- **Constraints carried:** Escape and a visible Skip end it from any
  step and set the flag; reduced-motion is respected; the overlay
  traps nothing permanently (the page behind stays the real page); the
  steps target stable anchors (nav tabs, the primary action), not
  layout coordinates.
- **Revisit when:** feedback or session replays show the tour
  interrupting returning users (flag loss in practice), or steps
  drifting from the surfaces they point at.

## 062 — CBT access codes: the beta rides the comp machinery (2026-08-10)

**Context.** A closed beta is planned (user direction, 2026-08-10):
participants receive a code, and redeeming it entitles the account to
three full packages — six scored 20-minute sessions each — without
payment. Two of the choices were the user's to make, because they are
distribution and money-shape questions, and both were put to them with
the trade-offs spelled out before any of this was built.

- **Chosen — one shared code (user decision, 2026-08-10).** The
  distribution plan is a group announcement, so per-person minting
  would cost the operator a code-per-participant send and buy only
  individual revocation. The leak exposure a shared code carries is
  bounded three separate ways: a redemption cap (`max_redemptions`),
  a kill switch (`disabled_at`), and the calendar expiry below — and
  redeemers are still identified, because every redemption row
  carries the account that made it. The schema holds many code rows,
  so a second cohort or a per-person pivot needs no rebuild.
- **Chosen — the beta ends on a calendar date (user decision,
  2026-08-10).** The code row carries `package_expires_at`; every
  package born from it gets that date written as its `expires_at` at
  birth. Existing expiry enforcement applies unchanged — new sessions
  refuse to start, artifacts stay readable — and usage data for
  rule ⑦ arrives inside a bounded window instead of trickling.
  Redeeming after the date is refused: a grant of already-expired
  packages would be a door painted on a wall.
- **Chosen — the grant is a comp, not a parallel free path.**
  `comped_at` is set at birth through the same seam the allowlist
  uses (the create hook in packages.py), so everything downstream
  keeps its one meaning: a session is a session, and nothing that
  counts money reads comp state (037). A new nullable
  `packages.cbt_code_id` names the code a package was born from, so
  the usage payload can show a CBT package as what it is.
- **Chosen — the entitlement counter lives on the redemption row.**
  `cbt_redemptions.packages_granted` increments at each comp-at-birth
  and caps at three. It is deliberately NOT a count of the account's
  live CBT packages: package deletion removes rows (037), so a
  live-count cap would be a delete button away from unlimited free
  packages — the exact hole the 060 amendment closed for the quick
  allowance, rebuilt one feature later. One redemption per account,
  ever (unique on `user_id`).
- **Storage and the guessing surface.** `cbt_codes` stores a SHA-256
  of the normalized code (trimmed, uppercased) — never the code
  itself; the operator mints through a `tools/` script that prints
  the plaintext exactly once. Redemption requires a signed-in
  account and is rate-limited per account (the FixedWindowLimiter
  primitives). Refusals are uniform toward strangers — a code that
  matches nothing is "not recognized" — while a caller whose code
  matched gets the honest state (beta ended, cap reached, already
  redeemed): whoever holds the code has nothing left to learn from
  the distinction, and a beta participant deserves a true sentence.
- **Rejected — per-person codes:** individual revocation is not worth
  N minted-and-DMed codes while the leak exposure is already bounded
  by cap, kill switch, and expiry. The revisit condition below names
  the day this flips.
- **Rejected — setting `paid_at`:** the same rejection as 037, which
  is the reason 037 exists — fabricated revenue in every money query,
  and rule ⑦ becomes unenforceable exactly when the first real
  external users arrive to test it.
- **Rejected — no expiry (what comps do today):** a beta that never
  ends is not a beta; it is a free tier that costs realtime-API money
  forever and was never priced as one.
- **Rejected — an entitlement column on accounts:** a second place
  that must agree with the redemption record. The redemption row
  already is the durable record of the grant; counting on it adds no
  new source of truth.
- **Metrics posture.** CBT participants are the first REAL external
  users. Their sessions count as real usage under rule ⑦ — unlike
  the operator's comped runs and the disclosed synthetic row — while
  their packages remain non-revenue and visibly CBT in the usage
  payload. `docs/metrics/README.md` states this in the same release
  this ships in.
- **Account deletion.** Deleting an account removes its redemption
  row with everything else (the privacy right stays whole, as the
  060 amendment set it), which technically lets a re-signup redeem
  again. Accepted: each redemption burns one of `max_redemptions`,
  so the shared cap bounds the loop, and the price of a lap around
  it is every report the participant made.
- **Revisit when:** the code leaks beyond the beta group and burns
  the cap (per-person codes and individual revocation then earn
  their cost), or a second cohort needs different terms — the table
  already holds multiple rows, so that day needs an operator command
  and no code.

## 063 — Route changes dissolve on the surface that never left (2026-08-10)

**Context.** The user's field read (2026-08-10): clicking into a new
screen feels choppy — nothing connects, and the product reads less
finished than it is. F-58 animated the data WITHIN pages; every route
change still swapped the whole screen in one frame. PRD v0.17→v0.18
ordering note: the v0.18 entry was recorded pre-code and this feature
was built by a parallel track alongside the v0.17 batch.

- **Chosen — a CSS enter animation on the content column, addressed
  by a root `template.tsx`.** The template is a `display: contents`
  client shell that applies a scope class through a tested predicate;
  the animation (`opacity 0→1`, 0.3 s, the house FADE_EASE) targets
  `<main>` inside that scope, and its replay trigger is React
  recreating `<main>` whenever the page component changes. The chrome
  around the content — top bar, footer — repaints identical pixels
  and holds still, so a navigation reads as content resolving onto a
  surface that never left, which is the continuity the user asked
  for, not a performance of it.
- **Rejected — React `<ViewTransition>` / the View Transitions API**
  (this Next version's blessed story): it requires an experimental
  flag in a config file outside the track's ownership, carries
  documented Safari differences, and its real power — shared-element
  morphs, directional slides — is exactly the showiness the motion
  budget rules out. Revisit when the flag is stable AND a genuine
  shared-element need appears (session row → session detail is the
  candidate).
- **Rejected — a motion/react wrapper in the template**: it would
  fade the entire surface including the chrome, and re-fading
  identical pixels reads as flicker — the opposite of continuity; it
  also waits for hydration and gives no-JS readers nothing, where
  CSS plays immediately.
- **Rejected — keying off the template's own remount**: by the
  bundled docs' semantics a root template remounts only when the
  FIRST path segment changes, so `/sessions` → `/sessions/[id]`
  would never animate. The chosen shape animates every navigation
  because a page-component change recreates `<main>` regardless of
  depth.
- **Supporting choices:** enter-only (the mechanism gives no free
  exit, and a blocking exit is forbidden); opacity-only with no
  travel (the screens' content already carries the granted
  reading-order rise — adding route-level travel would compound into
  a lurch); no `animation-fill-mode` (a filling animation would hold
  a stacking context on `<main>` and paint the home tour's fixed
  panes below the footer). All numbers come from the motion SSOT
  constants, gated by test.
- **The hero-cloud drift is scrub-linked, not clocked.** The
  landing's cloud lags the scroll by a twentieth (24 px over 480 px,
  unit-tested). It has no duration — the reader's scroll is the
  timeline — so the 0.3 s clock cap does not apply to it by
  construction; its budget is spatial. This is recorded as the
  posture for any future scrub-linked motion, not as an exception.
- **Accepted behavior, named:** a navigation that crosses a
  `loading.tsx` boundary settles twice (the skeleton enters, then
  the real content enters), and the first hard load fades once. CSS
  cannot distinguish arrival kinds; a consistent settle on every
  arrival is the coherent reading, and opting skeletons out would
  reintroduce the one-frame pop this exists to remove.
- **Unchanged on purpose:** control press scale stays declined
  (041); the session room receives nothing (F-50, user-excluded) —
  the exclusion is enforced by a tested predicate and, after review
  round 1, pinned against fragment-built class names and shadowed
  keyframe declarations (the standing obfuscated-literal lens, now
  applied to CSS).
- **Revisit when:** the View Transitions flag stabilizes and a
  shared-element need appears, or field feedback reads the
  double-settle through skeletons as pulsing.

## 064 — The interviewer acts like one: realism without touching the clock (2026-08-12)

**Context.** The voice agent's goal decomposes into "sounds like a
real person" (owned by the morgan_naturalness measurement loop) and
"ACTS like a real interviewer" — this entry is the second half (F-75,
user experience-definition discussion 2026-08-08). The card carried
one design tension to resolve before code: adaptive pacing and early
wrap-up versus the paid-session promise.

- **Chosen — three behaviors, all instruction-driven, all grounded in
  what the package already knows.** (a) Company-aware commentary: the
  interviewer may frame reactions in the company and role context the
  rubric actually carries (its `company`, `role_title`, and the JD
  evidence behind the dimensions) — and nothing else; no research
  pass, no invented team facts, because a fabricated "our team does X"
  from a product selling interview verdicts is a lie with a coach's
  voice. (b) Content-engaged reactions: before moving on, the
  interviewer engages the substance of what the candidate just said —
  a specific acknowledgment, a genuine follow-through — beyond the
  rubric-driven probe it already asks. (c) Adaptive closing register:
  the closing's CONTENT reflects how the interview went (what was
  strong, what the wrap-up gestures at), while its timing machinery is
  untouched.
- **Chosen — adaptive warmth, conservatively triggered.** Past the
  session midpoint, when the candidate has CLEARLY been answering
  strongly — the instructions define the bar as sustained, specific,
  structured answers, not one good moment — the interviewer may allow
  brief warmth (a short laugh, one light aside), then return to
  questions. In doubt, the professional register holds: a
  wrongly-warm interviewer is a false "you're doing well" signal, and
  the warmth's value is exactly that reading the interviewer loosen
  up is a real interview skill. The trigger is the model's in-session
  judgment under these instructions; the planner supplies the
  language, not the decision.
- **The tension, resolved: adaptivity changes WHAT is said, never
  WHEN the session ends.** No early wrap-up, no adaptive shortening.
  The 20-minute budget, the wrap-up window, the hard cut, and the
  exact closing sentence (the auto-end sentinel depends on its
  literal text) stay exactly as the cross-language timing twins gate
  them. A customer who paid for twenty minutes gets twenty minutes;
  an interviewer who is "done early" spends the remainder the way
  real ones do — deeper follow-ups, the candidate's questions —
  rather than leaving.
- **Rejected — adaptive early termination:** the paid promise above;
  also the timing constants are twin-gated on purpose and realism is
  not a reason to move them.
- **Rejected — a computed mid-session strength signal:** nothing
  scores mid-session (the eligibility floor exists because fair
  scoring needs the whole session), so any numeric trigger would be
  an invented number. Instructions describing the bar honestly beat
  a fake metric.
- **Rejected — extending this to quick interviews:** the quick
  session is a five-minute ungrounded funnel taste; its midpoint is
  ~2.5 minutes, far too little evidence for a "clearly strong" call,
  and its instructions stay simple on purpose.
- **Lever bookkeeping (mandatory, DECISIONS 047 discipline):** this
  is the first deliberate move of the instructions lever since the
  naturalness suite was built. Round 1 of that suite has not run
  (cases list empty, AVM references pending), so no baseline exists
  to poison — the move is recorded in the suite's worklog with the
  landing commit, and the judge rubric, when Round 1 authors it,
  must not penalize warmth (this entry is the pointer). The next
  gate report records the instructions hash as MOVED, by this.
- **Revisit when:** session replays show warmth firing on weak
  interviews (tighten the bar or pull the lever back), or customers
  read company-aware commentary as claiming inside knowledge the
  product does not have (then the framing language narrows further).

## 065 — flightcheck.coach: the domain that was buyable, honestly (2026-08-12)

**Context.** F-79 asked for a custom domain. The purchase is the
owner's money, so every fork below was theirs, decided with prices on
the table.

- **Chosen — flightcheck.coach, $19.99 first year, renews at $59.**
  Bought 2026-08-12 through Vercel (registrant: the owner), Vercel
  DNS, connected to the production project the same hour.
  **Auto-renew deliberately OFF** (owner decision): the renewal is a
  yearly decision at the then-current price, not a default — expiry
  2027-08-12 is on the calendar, not on a card.
- **Rejected — flightcheck.io (the owner's first choice):** registered
  since 2020, parked at an aftermarket with "Make an Offer" pricing —
  typically hundreds to thousands of dollars and a weeks-long
  transfer. Not worth it for a pre-revenue product; the owner passed
  on even inquiring.
- **Rejected — getflightcheck.com / prefix .coms:** cheapest .com
  trust ($11/yr), but the owner rejected the prefix pattern outright —
  the product's name is flightcheck, not getflightcheck.
- **Rejected — flightcheck.tech and the rest of the available field:**
  .tech reads startup-generic; .careers/.academy/.training are long or
  off-register. .coach won on the merits: the product IS an interview
  coach, and the TLD says so in one word. The known cost — new-gTLD
  TLDs carry a mild trust discount on payment pages versus .com/.io —
  is accepted and revisitable.
- **Process lesson, recorded for the next research task:** the
  availability research used rdap.org, whose .io coverage returns 404
  for REGISTERED domains — the "buy flightcheck.io" recommendation
  was wrong at the moment it was made, caught only at purchase time
  by Vercel's registrar-grade check. Availability claims must come
  from a registrar check or the registry's own RDAP endpoint, never
  rdap.org alone.
- **Cutover posture:** flightcheck.coach is the canonical origin
  (`SITE_URL`); the vercel.app address keeps serving and redirects so
  nothing breaks; canonicals/OG/sitemap/robots all derive from the
  constant; historical documents keep the address they shipped with.
  The auth redirect allowlist gains the new origin BEFORE the flip
  deploys — a login that bounces off an unlisted origin is the
  classic cutover self-inflicted outage.
- **Revisit when:** checkout metrics ever suggest TLD-trust friction
  (then the .com hedge gets bought), or flightcheck.io returns to a
  sane price (the brand-exact upgrade path stays open).

## 066 — The token gate reads cooked strings, not spellings (2026-08-13)

**Context.** The design-token scans (`tests/token-vocabulary.test.ts`,
plus the pins in `tests/design-system.test.ts`) match source text
line by line. B6's second review round proved the same hole twice in
one day: `` `${FIELD} bg-red-` + "500" `` — a palette class split
across two string fragments — walks the per-line regex, typecheck,
and lint, and it is exactly the obfuscated-literal class the standing
Codex-evasion review lens hunts by hand (`String.fromCharCode(8212)`
and a template-literal identifier split are both on the record in
RETRO.md). A rule held by a scan is only as strong as what the scan
can see (F-89).

- **Chosen: a second pass that reads cooked string values, via the
  TypeScript compiler already in the repo.** The scan keeps its
  per-line pass (line-numbered, readable failures) and adds a
  cooked pass: parse each scanned file with the `typescript` package
  the typecheck gate already installs, extract every string literal,
  template literal, and JSX text as its COOKED value (escape
  sequences decoded by the lexer itself, not by a second regex
  implementation of it), fold constant concatenations (`"a" + "b"`,
  adjacent template fragments, `${"..."}` interpolations whose
  content is itself constant), and resolve
  `String.fromCharCode`/`fromCodePoint` calls with constant numeric
  arguments. Rules then run over the folded values. A hit in the
  cooked pass that the line pass missed fails with the folded value
  named.
- **Chosen: the corpus is the contract.** A self-test corpus of known
  evasions lives beside the scan — fragment concatenation, template
  splits, `\uXXXX`/`\u{...}`/`\xXX` escapes, `fromCharCode`, an
  interpolation-split class — and the suite fails unless the scan
  catches EVERY corpus entry. The corpus is the list of tricks this
  repo has actually seen plus their obvious neighbors; a new evasion
  found in review gets added there first, so the gate's coverage is
  itself gated.
- **Rejected: regex normalization of the raw source** (collapse
  quote-plus-quote junctions, hand-decode escapes). It re-implements
  the JavaScript lexer badly: string boundaries, nested templates,
  and comment states are exactly the places the last three review
  rounds found scanner bugs (the comment-blanking history at the top
  of the scan file is a catalogue of them). The real lexer is already
  a devDependency; using it is less code and decodes correctly by
  construction.
- **Rejected: an external AST/linting dependency** for the same job —
  nothing new is needed; `typescript` is already there.
- **Rejected: replacing the per-line pass.** Its failure messages
  carry line numbers and trimmed source, which is what makes a red
  gate fixable in seconds. The cooked pass is additive.
- **Per-component pins stay.** The mutation-verified pins B5/B6 added
  are defense-in-depth for specific wiring; this entry moves the
  tree-wide floor so a component without a bespoke pin is still
  covered.
- **Revisit when:** the cooked pass measurably slows the suite (it
  parses ~150 files; budget is a few seconds), or a corpus entry
  requires evaluating anything beyond constant expressions — the
  scan must never grow an interpreter.

> Amended 2026-08-13, at merge, from the two review rounds. (a) The
> unknown-value placeholder is a SPACE, not NUL: both are non-word so
> every \b-anchored rule is identical, but the whole-value hex rule
> reads \s, and a NUL there hid `"#" + "8b5cf" + shade` from the one
> rule that should read it — a live evasion on the delivered tree.
> The accepted trade, measured: a template-built URL anchor whose
> fragment is 3-8 hex characters (`` `${DOCS}#cafe` ``) false-positives
> on that rule, is character-for-character the same folded shape as
> the pinned positive, and cannot be separated by any regex over a
> folded value; the named EXEMPT list is the route if it ever fires
> (zero such shapes in today's tree). (b) The corpus initially proved
> its own COPY of the rules — the self-referential-pin defect again —
> so the rules now live once in `tests/scan/cooked-rules.ts`, consumed
> by both the tree scan and the corpus, with a drift gate against the
> per-line vocabulary, a rule-count pin, and a rule-without-a-corpus-
> positive failure. (c) Round 2 found both prior passes blind to HTML
> character references (`&mdash;`, `&#8212;`, `&#45;`) that JSX decodes
> into real characters — reachable, since this product spells its
> typography as entities across 23 files. Decoding is scoped to
> exactly where the compiler decodes (JSX text and JSX attribute
> string values) and nowhere else, because `bg&#45;red&#45;500` in a
> plain string matches nothing and reporting it would be false. A
> parse failure in any scanned file fails the suite by throw — a file
> the parser drops nodes from must never read as clean.

## 067 — Generated questions are spoken sentences, not data (2026-08-13)

**Context.** `_generated_question` builds the fallback interview
question when a dimension has no bank entry (F-85, a B4 reviewer
finding deferred by agreement). Against the committed real rubric its
output was "Tell me about a time you demonstrated ai product strategy
& judgment. I'm especially interested in Strong Product Fundamentals:
Customer empathy, discovery, strategic thinking, prioritization,
product judgment in the field (translating customer reality into
product direction, credibly saying no)." — a lowercased acronym, an
ampersand the voice reads aloud, a colon-delimited label mid-sentence,
a forty-word interest clause, and a doubled period when the signal
ends with one. The exact-output tests never saw it because their
fixtures are tidy.

- **Chosen: three small spoken-language rules, applied only inside
  the generated fallback.** (a) Casing: a name word keeps its
  spelling if it carries any uppercase beyond its first letter ("AI",
  "AI/ML", "R&D"); otherwise it lowercases mid-sentence — so "AI
  Product Strategy & Judgment" reads "AI product strategy and
  judgment" while "Communication" still reads "communication".
  (b) Ampersand: a standalone "&" between words is spoken as "and".
  (c) Signals: strip a leading label prefix (a short pre-colon run
  with no sentence punctuation), strip trailing punctuation, cut to
  the first clause boundary (comma or opening parenthesis) so the
  interest clause stays speakable, and decase the first word by the
  same acronym-preserving rule. Doubled periods die with the
  trailing-punctuation strip.
- **Chosen: the pin moves to the real strings.** A new exact-output
  test reads the committed `evals/suites/rubric_discrimination/
  rubric.json` — the one real rubric in the tree — and asserts the
  full generated sentences for its dimensions. Tidy synthetic
  fixtures keep their role in the goldens, but the gate that matters
  quotes what a customer's rubric actually produces.
- **Rejected: keeping the label and dropping the elaboration**
  ("especially interested in strong product fundamentals"). It reads
  well for signals labeled with noun phrases and collapses for
  labels like "Rewarded:" — the tail is the content there. The tail
  is the content in every committed signal; the label is the
  redundant part.
- **Rejected: teaching the interviewer prompt to clean it up.** The
  interviewer already may rephrase sequence questions in her own
  voice, which is why this stayed deferred as long as it did — but
  the transcript, the report, and the study export all quote the
  PLANNED question text verbatim, so the data itself has to be a
  sentence.
- **Rejected: touching `_fit_question` or the banked path.** Banked
  questions are model-authored sentences already; the fit fallback
  interpolates JD-sourced titles whose casing is the JD's own. Scope
  follows the finding.
- **Cost accepted: the session-1 golden fixture regenerates.** Its
  synthetic signals carry the exact label-prefix shape the rule
  strips, so its expected strings change once, deliberately, in the
  same commit as the rule — hand-written expectations, not a blind
  regeneration.
- **Revisit when:** a committed rubric arrives whose signals defeat
  the clause cut (no comma, no parenthesis, 40+ words), or the
  fallback ever grows a second consumer that needs the raw signal.

> Amended 2026-08-13, at merge. Round 1 closed a real hole (U+00A0
> from pasted-JD `&nbsp;` defeated the clause cut and the punctuation
> strip) but closed it by collapsing whitespace FIRST, which deleted
> the leading space a `" ("`-headed signal needs to be cut — the
> parenthetical shipped as the spoken clause, the exact class this
> card removes. Round 2 restored the contract order (collapse last)
> and made the two whitespace-sensitive steps read `\s` instead of an
> ASCII space; a 71-signal differential harness pinned the blast
> radius to exactly the two parenthesis-headed cases. Known edges, on
> the record: a parenthesis with no preceding whitespace after the
> label strip still speaks the parenthesis (contract-faithful; falls
> under the existing revisit condition), and zero-width characters
> (U+200B, U+FEFF, U+2060, U+00AD) would defeat both rules but cannot
> reach a signal today because `promptsafe.strip_hidden_text` removes
> them at the rubric-compile intake chokepoint — this feature's
> guarantee depends on that chokepoint staying on the path.

## 068 — The quick complete stops asking storage for what cannot exist (2026-08-13)

**Context.** F-86: the session-complete route probed Supabase Storage
for a recording size before EVERY complete, including quick sessions —
which never record (the room skips the recorder when unscored, the
worker never reads `audio_path` for quick). The probe was a guaranteed
storage miss that logged `"could not read the recording size"` on a
normal quick ending, making a real failure indistinguishable from a
happy path.

- **Chosen: skip the probe when the authorized package's kind is
  quick**, on BOTH credential paths (legacy token and viewer), with an
  absent `kind` field behaving as standard — old serializations keep
  today's byte-for-byte behavior. For standard sessions nothing moves:
  positively observed oversize still refuses 413; an unreadable size
  still fails open with the error log, which now means something.
- **Chosen: `pkg.kind` from the authorization result**, not the
  session payload's `package_kind`. Both serialize the same
  `packages.kind` column and both auth paths guarantee the package IS
  the session's package, so divergence is unreachable; the
  authorization result is what the route already holds on both paths.
- **Rejected: keep probing and silence the log for quick.** The
  wasted storage round-trip stays, and a log line that is sometimes
  meaningless is the defect, not the spelling of it.
- **Rejected: teach `storedRecordingBytes` about kinds.** The helper
  reads storage; which sessions can have recordings is the route's
  knowledge.
- **Revisit when:** quick sessions ever gain a recording path, or a
  third package kind arrives.

## 069 — support@ speaks for the product, received without a new vendor account (2026-08-13)

**Context.** F-79's second half: the operator's personal Gmail sat on
every support surface (`SUPPORT_EMAIL` in `app/legal/policy.ts`,
consumed by the footer mailto and the settings deletion intake). The
domain cutover (065) made a branded address possible; the question was
how mail to it gets received, by whom, and at what standing cost.

- **Chosen: DNS-only forwarding via Forward Email's free tier, with
  the forwarding target encrypted in the published record.**
  `support@flightcheck.coach` forwards to the operator's mailbox
  through two MX records and one TXT record on the domain the product
  already owns — no new account, no new credential, no monthly cost.
  The TXT record is the encrypted form their service documents
  ("privacy should not be a feature"), so the personal destination
  address is not world-readable in DNS. Verified live before the code
  flip: the alias RCPT-accepts at their MX (250 2.1.5), with the
  first delivery greylisted exactly as their FAQ describes.
- **Chosen: the domain simultaneously locks down sending.** SPF
  (`v=spf1 a include:spf.forwardemail.net -all`) and DMARC
  (`p=reject`) published in the same change: this product sends no
  mail today, so the honest posture is "nobody may speak for this
  domain" — which also protects the support address from spoofing
  the day it starts appearing on legal pages.
- **Rejected: ImprovMX free tier.** Functionally equivalent
  forwarding, but configuration lives in their dashboard behind a new
  account — a standing credential and a vendor relationship for
  something DNS records express by themselves.
- **Rejected: Google Workspace.** A real mailbox with sending, ~$7/mo
  — the right answer the day support needs to SEND branded mail at
  volume, wrong as a first step for a product whose support load is
  a trickle into the operator's existing inbox.
- **Rejected: keeping the personal address.** It leaks the operator's
  primary mailbox to every visitor and reads as a hobby product on
  the one page where trust is being asked for (the refund policy).
- **Replying today** comes from the operator's mailbox (the alias is
  receive-only), which is honest for a beta: the reply-from address
  is the same one the old surfaces published anyway.
- **Revisit when:** support needs to send AS support@ (Forward
  Email's SMTP or Workspace — SPF/DMARC must change in the same
  batch), or reply volume makes a shared inbox worth paying for.

**Amendment (2026-08-14).** The chosen free tier never delivered: the
first real round-trip bounced `550 5.1.1 ... requires an upgrade to
Enhanced Protection` — Forward Email's free plan does not serve
`.coach`, a paid-plan TLD paywall its RCPT acceptance does not
mention. The "verified live before the code flip" claim above rested
on RCPT 250 plus a greylist reading; RCPT acceptance happens before
the paywall check, so only a DATA-phase delivery proves a forwarding
path. Receiving moved to ImprovMX's free tier the same day the
bounce surfaced (owner-approved): `.coach` is on their free plan
(only .tk/.ml/.ga/.cf/.gq are excluded), MX swapped to
mx1/mx2.improvmx.com, SPF to `v=spf1 include:spf.improvmx.com -all`,
DMARC untouched, the stale `forward-email=` TXT removed. This
reopens the rejected "vendor dashboard account" option with changed
facts — the no-account advantage was void for this TLD — and the
forwarding target now lives in that dashboard rather than in an
encrypted DNS record. Verified end to end in ImprovMX's delivery
log: the alias mail entered the queue and the forwarded copy was
accepted by `gmail-smtp-in.l.google.com` with `250 2.0.0 OK` two
seconds later. Testing caveat for the record: a self-addressed test
(Gmail to an alias forwarding back to the same Gmail) is silently
deduplicated after acceptance, so an empty inbox proves nothing past
the 250 — read the delivery log or send from a second address. No
code changed in this amendment; the address, the SUPPORT_EMAIL
constant, and the legal surfaces are exactly as v0.22 shipped them.

## 070 — Trend direction speaks in the pastel pair, not in alarm (2026-08-13)

**Context.** The dashboard's dimension-trends table (F-72, redrawn by
F-78) paints every sparkline the same translucent sky and prints the
net delta in plain ink — direction is deducible but not visible. The
user asked for colour coding on both (2026-08-13, screenshot
directive): rise, flat, and fall each legible at a glance, "legible
but harmonious." The palette has no grey wash and no ink-grade sky or
blush; `alarm`/`alarm-wash` exist but are declared for destructive
actions and true errors.

- **Chosen: extend the pastel pair's semantics.** Rising keeps the
  sky family, flat goes neutral (paper/ink family), falling goes to
  the blush family — blush's declared role is already "work in
  progress," which is exactly what a falling coaching score is. The
  net column gets ink-grade counterparts of the same reading. New
  tokens are declared in `globals.css`, composed through `lib/ui.ts`,
  and join `design-system.test.ts`'s lists as their usage honestly
  requires: a pairing that carries text joins the AA matrix; an
  SVG-only area fill is not a ground and does not pretend to be one.
  Exact hex values are the implementing track's design judgment
  inside those gates.
- **Rejected: reusing alarm for falling trends.** Alarm means
  something is broken or destructive. Painting a 0.2-point dip with
  the error red would false-alarm a customer mid-improvement and
  make true errors quieter by association.
- **Rejected: Tailwind opacity modifiers (`fill-sky/45`) for the
  wash.** The COMPOSITES gate classifies `fill-*` as text (4.5:1
  bar), which an intentionally quiet wash must fail; the SVG
  `fillOpacity` attribute (today's shape) or pre-composited wash
  hexes remain the mechanism.
- **Revisit when:** a third surface wants direction coding (extract
  a shared direction-to-tone module if the track has not already),
  or a "ready"-grade rising semantic (sage) earns its case.

**Merge amendment (2026-08-14).** What shipped, with the review
rounds' measurements. The ink-grade tokens are `trend-rise #33586b`
and `trend-fall #8c4a54`, both in the AA matrix; worst pairing
4.99:1 (trend-fall on sky). Flat declares no new token — its net is
`text-ink-faint`, its wash `fill-hairline` at the shared 0.45
opacity, which amends this entry's "neutral (paper/ink family)"
wording: measured over paper at 0.45, the candidates sit at ΔE 3.77
(hairline), 1.33 (paper-sunk, invisible), 24.30 (ink-faint, a slab)
from bare paper — hairline is the only one in the pastel washes'
weight class. Between the shipped washes: rise/flat 5.64, rise/fall
7.25, flat/fall 3.07 — the tight pair is flat/fall, modestly above
the ~2.3 just-noticeable threshold, acceptable ONLY because colour
is never the sole channel (the printed sign and the sr-only session
list carry direction); do not lighten blush without re-measuring
that margin. The falling wash sits ΔE 28.08 from an alarm-coloured
wash — "deliberately not alarm," now with a number. Direction
derives from `formatSigned`'s printed one-decimal rounding, so the
colour can never claim a move the figure denies; a characterization
pin records the half-up asymmetry inherited from ECMA rounding
(+0.05 prints "+0.1" and reads rising; -0.05 prints "0.0" and reads
flat). Review round 1 proved the original 305-case coherence sweep
never landed on a rounding boundary (a half-away-from-zero refactor
that breaks sign/colour agreement passed all 305) and rebuilt it as
567 cases through the exact halves. The revisit condition asking for
a shared direction-to-tone module is struck —
`components/trend-direction.ts` is that module. The hero
overall-trend chart is structurally unable to receive a direction
tone (its polygon hard-codes the sky wash), stronger than the
optional-default the plan asked for.

## 071 — Dimension glyphs are drawn by hand and chosen by keyword (2026-08-13)

**Context.** The user asked for a small pictogram before each
dimension name in the trends table (2026-08-13, same screenshot
directive) so the area registers at a glance. Dimension names are
rubric-compiled per JD — open-ended strings — so glyphs cannot be
hand-assigned per dimension the way F-43's session-state icons were.

- **Chosen: a deterministic keyword-to-glyph mapping over a fixed,
  hand-authored set.** Roughly eight to twelve inline SVGs drawn in
  the exact register F-43 established (24-unit viewBox, stroke
  `currentColor`, width 1.5, `aria-hidden` — the name beside the
  glyph carries the meaning), chosen by keyword rules over the
  dimension key and name, with a per-channel (content/delivery)
  fallback so an unmatched dimension degrades to its channel's
  glyph, never to a blank or a placeholder. The mapping lives in a
  JSX-free module unit-tested over the committed real rubric and the
  sample-report fixture: every known dimension must land a
  non-fallback glyph, and unknown names must fall back cleanly.
- **Rejected: @phosphor-icons** (already in the tree for the FAQ
  toggles). The glyphs sit beside F-43's hand-drawn icons in the
  signed-in product and should read as one hand; the FAQ's
  plus/minus are generic controls, not register-bearing pictograms.
- **Rejected: emoji** (banned by the house register) **and
  model-chosen icons at compile time** (nondeterministic, a per-JD
  cost, and a wrong glyph beside a customer's score is worse than an
  honest fallback).
- **Revisit when:** the real-rubric corpus grows dimension families
  the keyword table misses more often than it hits — the mapping
  test's fixture corpus measures the fallback rate.

**Merge amendment (2026-08-14).** The set shipped as ten pictograms
(wave, people, speech, person, compass, chip, scales, flag, fork,
notes), the component inline in `ProgressDimensionTable.tsx` rather
than a separate file, the mapping in
`components/dimension-glyph.ts`. Review round 2 confirmed the one
defect the committed corpus could not see: three keywords were bare
fragments and claimed names they do not mean — `model` took "Role
Modeling & Team Culture" for the technical chip, `drive` took
"Data-Driven Decision Making" for the ownership flag, `action` took
"Abstraction & Systems Thinking" for the ambiguity fork — breaking
this entry's own rule that a wrong pictogram is worse than an honest
fallback, from the other side. Fixed at review with whole-word
anchors; zero assignment changes across both fixture corpora ("Data
Modeling," outside them, now falls back honestly). Round 1 gave the
channel gate (delivery rows only ever wear the waveform, content
rows never) and the single-session row's glyph the pins they
shipped without.

## 072 — The room's black box survives the room (2026-08-14)

**Context.** F-67 (the interviewer answering itself on open
speakers) recurred a third time, and for the third time the
diagnostic trail built for exactly this moment (DECISIONS 046) died
with the closed tab — it lives in a client-side ring buffer,
rendered on demand, persisted nowhere. Three structural fixes have
been waiting on that evidence since the card was written (dynamic
VAD during playback, correlation-measured echo verdicts, transmit
gating); every patch so far was chosen on plausibility instead, and
each held only until the acoustics changed. The bottleneck is not
ideas, it is evidence retention.

- **Chosen: the trail rides the heartbeat.** The room already POSTs
  an authenticated heartbeat every 15 seconds; it now carries
  the diagnostic entries recorded since the last successful
  beat (a cursor over the existing ring buffer, left unadvanced on a
  failed beat so the next one re-carries the same delta), plus one
  final flush at the top of the clean end path. The worker appends
  the lines to a new nullable `sessions.diagnostics` column
  (migration 014), server-capped at 32 KB keeping the newest tail.
  The final flush runs on BOTH end paths — the clean end and the
  connection-loss guard, and the guard's is the one the trail exists
  for (review round 1 corrected this entry's "clean end" wording). The
  wire format carries absolute monotonic milliseconds (a new pure
  formatter) — the on-screen formatter's slice-relative clock would
  restart at zero on every delta. Deploy-order rule the review
  proved: `extra="forbid"` makes an unknown body field fail the
  WHOLE beat, and the client's re-carry cursor turns that into a
  poison pill — anyone adding a field to the beat body deploys the
  worker before the page. The privacy page's collection list gains
  the telemetry category in the same change, because "that is the
  whole list" must stay true. Two corrections from review round 2,
  which read this entry against the code rather than against round
  1: the heartbeat is authenticated but is NOT rate-limited (only
  session-start, scoring, package-create, feedback and cbt-redeem
  are), and the persisted trail is at-least-once rather than
  complete, so the original "nothing is lost" is struck. A beat
  whose write landed and whose response did not is appended twice;
  entries the ring trimmed before any beat carried them, a final
  flush that loses its race with the clean end's `/complete`, and an
  entry sharing a millisecond with the last one delivered are lost
  by design (`takeDiagDelta` is strictly-after, and browsers that
  clamp `performance.now()` to 1 ms make that tie reachable). Tags
  and offsets only: no audio, no transcript, no speech content;
  deleted with the session row, which round 2 also put under a test
  in `tests/test_api_deletion.py` — the column dies with the row in
  Postgres, and the fake now pops the trail the same way it pops a
  deleted row's transcript. The column joins no read payload
  (`SESSION_COLUMNS` unchanged) — the operator reads it by SQL when
  a recurrence needs it.
- **Chosen: the field is optional and an empty beat stays valid.**
  Deploy order guarantees a window where old pages meet the new
  worker; their bodyless heartbeats keep exactly today's contract
  (touch + 409-when-not-live, no append).
- **Rejected: upload once at session end.** The sessions that need
  the trail most — crashes, kills, connection loss — are precisely
  the ones that never reach the end path. An end-only flush records
  the healthy and loses the sick.
- **Rejected: a dedicated diagnostics endpoint.** A new
  authenticated, rate-limited surface for a signal a periodic authed
  POST already carries; more code, same evidence.
- **Rejected: a download button in the disclosure.** It returns the
  evidence burden to the user at reproduction time, which is the
  exact failure mode this entry exists to end.
- **Revisit when:** Phase 1 lands and the trail's volume or
  retention needs revisiting, or the deletion policy changes shape.

## 073 — The Google door always offers the chooser (2026-08-14)

**Context.** F-93, verified live rather than assumed: a returning,
already-consented customer clicking Continue with Google sees no
Google page at all — GoTrue's authorize round-trip bounces silently
back into the product, because nothing passes a `prompt` parameter.
That silence is the wrong-account trap: a customer holding a work
and a personal Google is logged into whichever the browser favors,
with no moment to choose. The user asked for the standard chooser
(2026-08-14, workos.com screenshot), and appending
`prompt=select_account` to the authorize URL was verified live to
surface it — GoTrue forwards `queryParams` untouched.

- **Chosen: `queryParams: { prompt: "select_account" }`** on the
  login page's `signInWithOAuth`. The trade, named honestly: a
  returning single-account customer pays one extra click, in
  exchange for an explicit door, an unambiguous "this is Google"
  moment, and wrong-account protection for everyone with more than
  one identity.
- **Rejected: `prompt=consent`.** Re-asks scope grants, not just
  the account — heavier than the ask and re-consents nothing that
  needs it.
- **Rejected: leaving the silent bounce.** It reads as broken (the
  click appears to do nothing but reload) and silently picks an
  account, which is the exact failure the chooser exists to prevent.
- **The branding half stays open on F-93's card**: the trust line
  still names the Supabase infrastructure domain. The recorded fork
  — free Google consent-screen brand verification first (app name,
  logo, flightcheck.coach as authorized domain; days-to-weeks
  review), the paid Supabase custom auth domain (~$10/mo, Pro plan)
  only if the free path empirically fails — is the owner's call at
  the money gate. DECISIONS 036's consent-screen revisit condition
  closes only when that half ships.
- **Revisit when:** funnel data shows chooser friction for
  returning customers, or the branding half lands and the whole
  door can be judged as one surface.

## 074 — The room turns the server's ear down while the interviewer speaks (2026-08-15)

**Context.** F-67 Phase 1. The open-speaker reproduction that
DECISIONS 072's persisted trail was built for happened on 2026-08-14,
and the trail did its job: for the first time in four occurrences,
the mechanisms are timestamped facts instead of hypotheses. Three
were confirmed. (1) **Echo as barge-in during playback**: the echo of
the interviewer's own greeting was detected as candidate speech WHILE
he spoke, and the resulting barge-in at +9.4s truncated the greeting
2.9 seconds in. (2) **Self-advance from a commit outside the playback
window**: that barge-in's commit WAS suppressed by the timing
heuristic (`commit-echo-suppressed 1096ms` — the overlap physics work
where they apply), but a second phantom segment started 1.3 seconds
AFTER `morgan-quiet` — an echo/buffer tail outside the 400 ms
start window — committed unsuppressed, and the interviewer answered
his own echo. (3) A turn-policy failure that is not echo at all,
split to DECISIONS 075. This entry is the fix for (1) and most of
(2): the "dynamic VAD during playback" row of 072's decision matrix,
chosen because the trail shows that exact class and not by
plausibility, which is how the previous three patches were chosen and
why there was a fourth occurrence to record.

- **Chosen: playback-aware input gating.** While the interviewer is
  audible (the `output_audio_buffer` lifecycle or the remote
  analyser, the room's existing two-source rule) plus a hangover
  after he goes quiet — 2.0 seconds, sized above the measured 1.3 s
  phantom tail with margin — the client raises the server VAD
  threshold with a `session.update` and restores it when the
  hangover expires. The gated value discriminates by level: leaked
  speaker audio arrives at the microphone well below a close-talking
  candidate's level (the echo floor — the same measured-margin
  derivation that put the resting threshold at 0.6 in the 2026-08-01
  diagnostic run, where real speech "clears it comfortably" and
  ambient phantoms do not). So a genuine interruption still starts a
  turn while the gate is up; echo no longer can, once it is.
  (Corrected at merge by review round 2, which read this entry
  against the shipped code: the gate goes up one ticker period,
  250 ms, plus a session.update round trip after the interviewer's
  audio starts, so the onset of each utterance is still ungated and
  still relies on the timing heuristics behind it — which is the
  layering this entry keeps, not a defect in it. The original "during
  playback or in its tail" claimed the onset too, and that was not
  true.) Earphone sessions see no behavioral change by
  construction — no leak reaches the mic, so nothing there ever
  depended on the lower threshold during playback — and the
  both-environments verification bar below holds this to evidence.
  The gate lives in the session-room reducer as pure state emitting
  a `session.update` effect, under the reducer's adversarial test
  discipline; the reducer stays the sole `response.create` source
  and this adds none.
- **Chosen: the gate is visible in the trail.** Gate transitions
  (raise/restore, with the applied value) become diagnostics
  entries, and a session-start marker now opens every real start
  attempt — the wall-clock anchor the persisted column needs once
  the monotonic clock has restarted on rearm or reload. The Phase 0
  open item closes here. (Corrected at merge: this entry first said
  the marker opens "every trail slice" — heartbeat delta slices do
  not each carry one, and a guard-blocked Start click deliberately
  writes none; review round 1 moved the marker behind the re-entry
  guard so a blocked click cannot plant a false slice boundary, and
  round 2 caught the overclaim in this sentence.)
- **Chosen: the timing heuristics stay.** The 400 ms start window
  and the 2400 ms outlive floor remain as the second layer — they
  demonstrably caught mechanism (1)'s commit — but they are no
  longer the only defense against the class they cannot see:
  episodes that start outside the window.
- **Rejected: transmit gating (mute the mic during playback).** The
  third row of 072's matrix. It makes barge-in impossible by
  construction — the candidate could never interrupt, which a real
  interviewer allows — and it is a pure loss for earphone sessions,
  which never leak. A feature that must behave that differently
  between the two first-class audio environments fails the standing
  directive on its face.
- **Rejected: widening the client-side start window to cover the
  tail.** The timing heuristic has already swallowed a genuine first
  answer once (DECISIONS 052's filed evidence,
  `commit-echo-suppressed 1066ms`); stretching its windows grows
  exactly that false-suppression class. Gating at the source
  prevents the phantom from ever committing instead of arguing about
  it afterwards.
- **Rejected: a permanently higher threshold.** It taxes the
  quietest honest speaker for the whole session. The gated value is
  affordable precisely because it applies only while echo is
  physically possible.
- **Lever discipline:** the gated threshold and the hangover are
  recorded levers (the naturalness suite's `lever_state` contract
  and worklog), like every VAD/turn parameter since DECISIONS 047.
- **Verification bar:** one real open-speaker session AND one real
  earphone session, both with trails read. The earphone session must
  show nothing changed but the trail entries. Both trails must also
  show a `vad-ack` following the first `vad-raise`, with the
  interviewer's voice and persona unchanged after it: the raise's
  session.update carries only the turn_detection block, so it is
  correct only if the server merges an update into the live session
  rather than replacing it — an assumption nothing in this repo has
  exercised mid-session (round 2's finding; the one live
  session.update on record is sent once at connect). No local test
  can see this; the first real session settles it.
- **Revisit when:** a trail shows a real barge-in missed while
  gated (the gated value is too high), or a phantom surviving the
  hangover (the tail runs longer than 2 s), or the Realtime API
  grows server-side echo handling that makes client gating
  redundant.

## 075 — semantic_vad gets a re-audition: numbers or nothing (2026-08-15)

**Context.** The third mechanism on the 2026-08-14 trail is a
turn-policy failure, not echo: the candidate's multi-segment answer
committed at +70.0s, the 0.6 s client debounce (DECISIONS 055) fired
at +70.8s, the candidate RESUMED at +71.1s, and the interviewer
talked over them from +71.7s. A thinking pause of roughly 1.6 s also
closed a turn early — past the 900 ms VAD tail, so the acoustic
guard cannot help; the pause was silence, and `server_vad` counts
silence. Also on the trail: a debounce deferred through the
interviewer's own audio fired the moment `response-done` landed,
producing back-to-back interviewer utterances (+81.2s quiet, +82.5s
speaking again). The structural answer to "silence is not the end of
a thought" is semantic turn detection — the API's `semantic_vad`
judges whether the utterance reads complete instead of counting
quiet. This log already disqualified it once, on measurement
(DECISIONS 009, 2026-08-01): low eagerness never committed a
complete answer (2/2), auto eagerness interrupted an 8 s thinking
pause at ~4.4 s and invented content, and both starved the client
clock of events while holding a turn. Whether the shipping API has
outgrown those measurements is an empirical question, and this
defect's whole Phase 0 existed to end fixing-by-plausibility.

- **Chosen: an empirical re-audition, gated on numbers.** The lab
  harness (`webroom/server.py`) runs the 2026-08-01 bake-off
  scenarios again — complete answer, mid-answer thinking pause,
  filler stall, held-turn event visibility — at low and medium
  eagerness, against current API documentation. The bar it must
  clear is 009's four failures inverted: a complete answer commits
  with bounded latency (comparable to today's ~1.5 s total quiet);
  an 8 s mid-answer thinking pause is NOT interrupted; turn events
  remain visible while a turn is held (the client clock and the
  connection guard both feed on them); zero uninvited responses
  under `create_response: false`. Only a lab pass earns one real
  session behind a recorded lever. Adopt or reject on the numbers;
  either way the run lands in `evals/reports/` and this log gains
  the verdict.
- **Rejected: adopting on the field defect alone.** The 009
  measurements are the most recent data this repo holds on
  semantic_vad. "The industry uses it for thinking pauses" is
  exactly the plausibility-shaped reasoning the trail exists to
  replace.
- **Rejected: stretching `silence_duration_ms` instead.** Taxes
  every turn transition including genuinely complete answers (009's
  original rejection, still true), and the failure is the policy —
  counting silence — not the count.
- **Rejected: a client-side resume-grace (cancel the response when
  the candidate resumes).** `response.cancel` against
  already-streaming audio is truncation machinery — the class
  `interrupt_response: false` exists to keep out of this product —
  and it answers the talk-over symptom while leaving the early
  close in place.
- **Carried observation:** the deferred-debounce double utterance
  (+81.2s/+82.5s above). If semantic_vad is adopted, the debounce
  machinery changes shape anyway; if it is rejected, that
  observation gets its own turn-policy pass on `server_vad` rather
  than dying in this entry.
- **Revisit when:** the re-audition report lands (this entry gains
  the verdict and its numbers), or OpenAI ships a semantic_vad
  revision that invalidates the new measurements.
- **VERDICT (recorded same day, 2026-08-15): REJECTED, on the
  numbers.** Full report:
  `evals/reports/2026-08-15-f67-semantic-vad-reaudition.md`. Low
  eagerness reproduced its 2026-08-01 disqualifier — two of three
  tape-final complete segments never committed (≥12.1 s and ≥11.1 s
  of observed silence), while the one that did was ideal (+0.95 s
  after true completion, 8 s pause held) — an unpredictable strand
  is a strand. Medium eagerness committed 4.6 s INTO the 8 s
  thinking pause (the exact failure this re-audition existed to
  rule out), tripled answer-end latency (+4.6 s vs the same-day
  server_vad control's +0.99 s), and chunked filler stalls into
  multi-second episodes that defeat the stall-blip filter's
  contract. Both cells starve the client clock while a turn is
  held (17.5 s to indefinite with zero events), which composes
  catastrophically with create_response:false — no commit means no
  debounce, no scaffolds, a dead room to the hard cut. The one
  clean pass: zero uninvited responses in all nine runs. The
  conditionally budgeted real session is not spent; the carried
  observation (deferred debounce, resumed-answer talk-over) becomes
  a client-side turn-policy work item on server_vad, registered on
  the F-67 card.

## 076 — The echo verdict becomes a measurement, in shadow first (2026-08-15)

**Context.** Today's echo verdict is timing physics alone: a
candidate episode STARTING within 400 ms of interviewer audio is
suspect, and a suspect commit is purged unless it OUTLIVED his audio
by 2400 ms. The 2026-08-14 trail showed both sides of that
heuristic's ledger in one session: it correctly suppressed the
echo-barge-in's commit (`commit-echo-suppressed 1096ms`), it has
swallowed a genuine first answer before (DECISIONS 052), and it is
structurally blind to an episode that starts outside its window
(074's mechanism 2). The room already holds the signal needed to
measure instead of infer: two AnalyserNodes, microphone and remote.
This is the "correlation-measured echo verdicts" row of 072's
matrix, shipped as the backstop behind 074's gating.

- **Chosen: cross-correlation verdict, recorded in shadow.** A pure
  module keeps short rolling level-envelope series from both
  analysers; when a commit (or a suppression) lands, it
  cross-correlates the microphone envelope against the interviewer
  envelope over the episode window across small lags. An echo is
  the remote signal re-entering the mic — high correlation at some
  acoustic lag; a real answer is uncorrelated. The verdict
  (coefficient plus echo/speech/indeterminate) is appended to the
  diagnostics trail BESIDE the timing verdict on every judged
  commit; entries whose window holds fewer than four ticks —
  including commits with no preceding speech_started — carry an
  honest n=0 or n<4 indeterminate placeholder rather than a
  measurement (merge amendment, from review). Shadow means shadow:
  the timing heuristic keeps authority, and no behavior changes on
  the correlation verdict in this phase — a property the review
  rounds turned from prose into a test after proving it walkable
  (consulting the verdict beside its diag call tripped nothing
  until the verdict's fields were pinned absent from the room).
- **Why shadow:** a detector whose false-suppress class eats real
  first answers must not take authority on lab confidence. The
  promotion gate is recorded field evidence — open-speaker AND
  earphone trails showing the correlation verdict separating the
  classes the timing margins cannot — and promotion is its own
  logged decision with those trails cited.
- **Rejected: raw-waveform cross-correlation.** The analysers are
  sampled on the client's coarse tick; waveform alignment wants a
  continuous capture path the room does not have, for accuracy the
  envelope form may already deliver at this job's scale (the
  question is "same shape as the remote audio, slightly delayed?",
  not "which millisecond"). Measure the cheap form first; the
  shadow ledger will say if it is not enough.
- **Rejected: promoting to authority in the same change.** That
  would be choosing a fix and its validation in one motion, from
  the same desk, which is the pattern 072 retired.
- **Revisit when:** the shadow ledger holds enough judged commits
  across both environments to compare detectors, read STRATIFIED BY
  n and never pooled — then either promote (own entry), or record
  that envelope correlation cannot separate the classes and
  reconsider the capture path.

## 077 — The greeting stops where the reply belongs (2026-08-15)

**Context.** The first open-speaker session on the Phase 1 gating
(the same slot as the 2026-08-14 reproduction, run 2026-08-15 08:55
KST) split the defect cleanly in two. The trail shows the acoustic
half closed: one `greeting-sent`, one response, `vad-raise` 53 ms
after the interviewer's audio started and `vad-ack` 279 ms later,
`vad-restore` + ack at hangover expiry, and ZERO echo events across
a 24.5-second open-speaker playback — where yesterday's slice of
the same column logged a barge-in, a suppressed echo commit, two
phantom commits and four spurious response triggers. The raise's
partial session.update merged (persona and voice intact by ear),
retiring 074's one unexercised assumption. And the transcript shows
what the echo had been masking, in a single segment: the
interviewer's one opening response swallowed both checks it was
told to wait on — "Can you hear me okay? All right, great. …
Sound good? All right, let's dive in." — and rolled into the first
question. The machinery armed exactly one response and then waited
honestly; the monologue happened INSIDE it. The OPENING
instructions already said "Wait for their reply" twice, but prose
cannot be obeyed mid-utterance: for a realtime model, waiting means
ENDING the turn, and nothing said so. This is the original F-67
card's candidate fix ① (instructions pinning the greeting to wait),
isolated at last by Phase 1 removing the acoustics that masked it.

- **Chosen: structural turn stops in the opening.** Beat 1 becomes
  the whole first turn — say the hello and the audio check, then
  stop speaking and end the turn; never answer the check yourself;
  the reply arrives as the candidate's turn. The "Sound good?"
  check before the first question gets the same structural stop.
  The framing content between them is unchanged. The FIRST stop
  carries an explicit "if they stay silent, a [silence status] note
  will prompt you; never fill the silence on your own"; the "Sound
  good?" stop relies on the same ladder without restating it
  (corrected at merge — this entry first claimed both stops carry
  the line). And the ladder's own staged texts are written for a
  candidate stuck mid-question ("where they were heading", "set
  this question aside — want to try the next one instead?"), which
  reads wrong at a greeting and at 30 seconds walks the
  interviewer into offering to skip the audio check: making the
  opening a place the ladder can fire is NEW in this entry, and
  the ladder's greeting-time wording is registered open work on
  the web side (review round 2's finding; the silent candidate —
  dead mic, heard nothing to answer — is the realistic bad-audio
  path, and it is the ladder's branch).
- **Chosen: the quick interview's opening gets the same stops.**
  Its # OPENING has no stop at all, and it is the free funnel's
  first impression. The byte-for-byte pin that froze the quick
  instructions during the B7 move (suite worklog, 2026-08-12) is
  deliberately updated with this entry as the reason: the pin
  exists against accidental drift, not against recorded decisions.
- **Rejected: splitting the opening into two client-armed
  responses.** The client could nudge beat 1 only and let the
  normal commit-and-debounce machinery produce the rest. It is the
  structural guarantee — but it adds an opening-specific response
  policy to a room whose reducer is deliberately the sole, uniform
  response source. Instructions are the cheap first lever and the
  next transcript verifies them. If a trail shows the monologue
  rolling through a structural stop, this split is the recorded
  next move, not a new debate.
- **Rejected: leaving it.** The first minute of every session,
  paid and demo alike, is the interviewer interviewing itself.
- **Lever discipline:** this moves the instructions lever (the
  naturalness suite's worklog gains the entry; F-69 contract).
- **Verification:** the next real session's transcript shows the
  opening as separate interviewer segments — the check as its own
  turn, the framing as its own turn after the candidate's reply —
  and the earphone session (074's still-open other half) can serve
  as exactly that session.
- **Merge amendment (2026-08-15, from the review rounds):** the
  stop is what makes a negative answer reachable at all, so both
  renders also forbid railroading past one — "if they say they
  cannot hear you well, sort that out with them before any
  framing". What the interviewer does about it is deliberately
  unscripted: a hiring manager troubleshoots audio on a video
  call, and the product's own mic-failure copy already tells
  users to reload. The silent branch is not covered by this
  clause and remains the ladder's job (the open item above). The
  self-answer ban was also generalized in review — the original
  named only the two tokens the transcript happened to contain
  ("great", "all right"), the recorded absolute-claim trap; it
  now closes over the reply itself ("no reaction of any kind to a
  reply you have not heard"), which simultaneously scopes the
  named tokens to the check.
- **Revisit when:** any transcript shows a monologue rolling
  through a structural stop (then the two-response split), or
  field sessions show the stops making the opening feel stilted
  and interrogative rather than warm.
- **Merge amendment (2026-08-15, from the review rounds' measured
  null distribution):** r is maximised over nine lags, so on
  NON-echo episodes the verdict still reads "echo" 76% of the time
  at a four-sample (0.75 s) window, 35% at six samples, 15% at
  eight, settling to 0.1% only at twenty — a short-window "echo" in
  the trail is close to no evidence. The table lives in the module
  docblock and is pinned two-sided by tests that parse it from the
  source, so it cannot drift from the code that produced it. The
  four-sample floor was KEPT at merge, deliberately: the phantom
  class this backstop exists to watch (the measured 1.3 s tail) is
  a short episode, and raising the floor would blind the ledger to
  exactly that class. The trail records r, lag, and n on every
  entry, so the promotion analysis can re-threshold offline; what
  it may never do is pool across n. The review also proved the
  correlation guard load-bearing at the caller (a flat paired
  SUBSET normalises to r = 1 exactly — a perfect echo from
  nothing), now pinned.

## 078 — peripheral rubric areas: indirect by rule, capped by evidence (2026-08-15)

- **Decision:** `RubricDimension` gains `probing_mode` (`direct` |
  `indirect`, default `direct` so every stored rubric parses unchanged —
  the `jd_evidence` precedent). The ethics/safety family — a whole-word
  classification list held in one module constant and driven over the
  committed rubric corpus by test; the fit dimension and every
  delivery-channel dimension excluded — is ALWAYS `indirect` on newly
  compiled rubrics: no minted main question, excluded from the opening
  area list, excluded from focus and pressure-probe targeting, judged
  from evidence across the whole transcript with a rationale that names
  where the evidence came from, and labeled honestly on the rubric page.
  Weight is governed conditionally: a deterministic emphasis heuristic
  (three or more distinct JD lines naming the family = the JD genuinely
  foregrounds it) decides whether the compiled weight stands; when the JD
  does not foreground the family, the dimension is clamped to 0.10 and
  the excess redistributes proportionally, keeping the 0.01 sum
  tolerance. The compiler prompt teaches the same policy first-pass; the
  deterministic post-pass beside the faithfulness gate is the
  enforcement. The faithfulness eval suite gains governance checks so
  the release gate validates this live.
- **Why:** the operator's own rubric is the exhibit: "AI Safety and
  Mission Alignment," one of eight dimensions with a dedicated grilled
  question, scored 2.6 — lowest — and the F-83 focus-weakest mechanism
  then aimed the next paid session at it. Real interviews read these
  areas through follow-ups and interpretation. A rubric the customer
  cannot agree with voids the trust the whole package runs on, and since
  F-84 the rubric is also a pre-purchase surface.
- **Rejected — an unconditional weight cap:** an alignment-team JD
  genuinely foregrounds safety; capping it there would misread the JD,
  and `ai-safety-genuine` exists in the faithfulness fixtures precisely
  to keep that honest. The cap is conditional on the JD's own text; the
  probing mode is not (user directive: these areas are asked sideways,
  everywhere).
- **Rejected — prompt-only enforcement:** prompt drift regresses
  silently; the post-pass is the guarantee and the prompt just reduces
  repair retries.
- **Rejected — retroactive mutation of stored rubrics:** a customer's
  rubric changing mid-package is a worse trust break than the one being
  fixed. New compiles only.
- **Revisit when:** feedback names a peripheral area a customer wanted
  centered (the indirect experience reading as neglect), or a second
  family earns a place on the list — the user scoped it to ethics
  deliberately, and widening it is a product call, not a code call.

## 079 — the advised drills reach the next interviewer (2026-08-15)

- **Decision:** `build_interviewer_instructions` gains
  `drills: Sequence[str] = ()`; the session mint and read paths pass the
  most recent scored session's `report.next_drills`; the standard branch
  renders one calm carry-over block — the candidate was advised these
  improvements last time; listen for whether they landed, probe once if
  natural. `SessionReportLike` widens to declare `next_drills`. The
  golden instruction fixtures stay byte-identical when no drills exist.
- **Why:** F-09's remainder. The report tells the customer what to
  drill; the next session's interviewer had no memory of it — a coach
  that forgets its own advice is six strangers, not a program.
- **Rejected — a `SessionPlan` schema field:** it would cross the web
  type mirror for data the browser never renders; the instruction text
  is the only consumer.
- **Rejected — feeding the full history's drills:** stale advice
  compounds; the most recent scored session is the live coaching state.
- **Revisit when:** cross-package coaching continuity (the rest of
  F-09's original framing) is scheduled.
