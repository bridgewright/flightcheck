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
  (`services/scorer/src/scorer/api/app.py`) the `is_expired` check runs
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
  (v0.6).
- **Rejected — no refund window:** "never" is not an honest answer to a
  broken recording.
- **Revisit when:** deletion requests exceed a manual cadence, or v0.6
  ships F-34 self-serve deletion.

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
  `frame-ancestors 'none'`, an explicit four-origin `connect-src`
  allowlist, `form-action` scoped to the checkout origins, and
  `Permissions-Policy` granting the microphone on the room route only.
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

## 031 — two client dependencies, and the boundary they are allowed to cross (2026-08-04)

*F-21. The product's first runtime client dependencies.*

- **Decision:** `motion` and `@phosphor-icons/react` enter the web app, under
  two rules. Motion is confined to three leaf components under
  `components/motion/` that take only presentational props and render their
  children; every screen using them stays a server component. Icons are
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
