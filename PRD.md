# PRD — flightcheck

*Committed before the first line of source code, on purpose. This document is the contract; the code follows it.*

## Problem

Non-native English speakers preparing for interviews at global tech companies have no way to answer three questions before the real interview: **Would I pass today? What exactly is missing? Is it my content or my delivery?**

Generic AI voice chat (free) can converse but cannot judge against a specific job's bar, cannot track growth across sessions, and — because cascade pipelines transcribe speech to text before the model sees it — cannot hear hesitation, fillers, or intonation at all. Human interview coaches can, at $70–150/session.

## Product

Paste the job description you are applying to. flightcheck researches how that company and role actually interview (public interview experiences, hiring guides, the JD itself), compiles an evidence-grounded rubric for that exact role, interviews you about it by voice — a native speech-to-speech conversation that feels like a real interviewer — scores every session on two channels (content from the transcript, delivery from the raw audio), and tells you honestly: **Ready / Approaching / Not ready**, what is missing, and what to drill next. Sessions repeat until you are ready.

> **Not built, stated here because this paragraph is the product's own definition:**
> sessions do not yet vary. Every one runs the same baseline plan compiled from the
> rubric — `sessionplan/planner.py` is pure, `session_index` is fixed and `focus` is
> pinned to `baseline` — so the questions repeat. The version that varies them is
> curriculum-lite, and it has shipped in no release. This sentence read "repeat with
> fresh topics" until 2026-08-04, when the release audit found the same claim on the
> landing page, the paywall and the page shown after payment, while `README.md` said
> the opposite in the open.
>
> **Resolved 2026-08-08 (DECISIONS 058):** the original lateness record above
> remains visible. Sessions now vary by question-bank rotation and history-aimed
> ordering, with prior stored question text excluded before each selection.

## Users

- Primary: non-native English speakers (Korean first market) interviewing at global tech companies.
- First verticals with quality guarantees: AI deployment / forward-deployed / technical PM roles. The pipeline is role-agnostic; verticals expand with validated rubric corpora.

## Package (pricing)

One JD = one package: **$49 · 30 days · 6 sessions × 20 min · per-session reports · final Ready verdict.** No subscription. The free tier is the five-minute quick interview (a company name and a role, unscored, honestly labeled); registering a real JD is free up to the compiled rubric — the bar made visible — and every full 20-minute scored session is paid. The 30-day window starts at payment (new starts only; reports stay readable). Honest-verdict policy: if not ready by session 6, the product says so — never a courtesy pass.

> 2026-08-03: price restated from ₩89,000 to $49 USD (single global price
> story) and the trial-then-unlock model added with v0.5 payments — full
> options-and-rejections trail in [DECISIONS.md #018](DECISIONS.md) and
> [#019](DECISIONS.md).

> 2026-08-10: the free trial session (first session on a package, scored,
> free) retired with v0.16 — the quick interview replaced it as the one
> free door. The paragraph above still described trial-then-unlock as
> current an hour after the code changed, and would have shipped that way
> in the tag had the release audit not read it; corrected here, in the
> open. Trail: [DECISIONS.md #060](DECISIONS.md) and the v0.16 scope
> entry below.

## Success metrics (targets set in advance — v1.0 = 2026-08-21)

| Metric | Target | By | Measured by |
| --- | --- | --- | --- |
| Judge–human scoring agreement (Cohen's κ) | ≥ 0.8 | v1.0 | not built — no suite computes κ. Interim proxy only: on the three golden triplets, the human blind rankings (`evals/suites/rubric_discrimination/manual/`) and the judge each match the key 3/3 — ordering agreement at N=3, not κ |
| "This feedback was actually useful" (post-session) | ≥ 80% | v1.0 | not built — nothing in the product asks the question: no prompt, no route, no column. F-13 instrumented session completion, package burn-through and scoring latency; this was not among them, and no release currently carries it |
| First-response latency, user stops → interviewer speaks (p50) | ≤ 800 ms | v0.2 | unmeasured in production. Since 2026-08-07 the worker DOES time this direction on evals recordings (`morgan_response_latencies`: candidate-end → interviewer-start, mean and p90, stamped into every Morgan metrics document) — but it runs over eval clips, not production sessions, and reports p90, not the p50 this row names. The scorer's `avg_response_latency_s` remains the opposite direction and cannot stand in; F-13 publishes this figure as `None` with that reason attached |
| Session completion rate (no mid-session abandonment) | ≥ 85% | v0.2 | session status (`scored` + `insufficient`) against sessions that opened a room (`secret_mints`) — computed by F-13: `GET /api/metrics/usage`, rendered by `services/scorer/tools/usage_report.py`. Unreported for want of external users, not for want of an instrument |
| Package utilization (sessions actually used, of 6) | ≥ 4 | v1.0 | package burn-through, off the same F-13 endpoint and report. Unreported for the same reason: every package that exists is the operator's |
| Paid packages, external customer only (operator verification orders excluded) | ≥ 1 | 2026-08-23 | Polar orders (the `orders` table; receipts in settings) placed by an account other than the operator's |

Changes to targets are recorded here with date and reason — never silently.

> 2026-08-01: the "Paid packages ≥ 1 · 2026-08-23" target's timeline moved —
> payments now start no earlier than v0.3 (product depth first). The target
> number itself stays as written; full options-and-rejections trail in
> [DECISIONS.md #008](DECISIONS.md).

> 2026-08-03: the "Measured by" column, added earlier the same day, named
> two instruments that do not exist — the latency row cited a scorer field
> that measures the opposite direction, and the κ row cited a golden-set
> comparison no suite computes. Both cells now say so. Two targets also
> carried the deadline **v0.2**, which shipped 2026-08-01 with neither
> measured and nothing recorded here; that is closed below. No target
> number and no original deadline changes in this entry — every one of them
> standing untouched since the first PRD commit (2026-07-25) is what makes
> "set in advance" checkable, and any re-set will be its own dated note.
>
> - **First-response latency ≤ 800 ms (p50) — unmeasured, and now known to
>   contradict a later decision.** Nothing instrumented the interviewer
>   side of a turn when this was written (see the table row above for
>   what F-70 added on 2026-08-07, and why it still is not this metric). DECISIONS 009 then made the wait deliberate: a 900 ms
>   server-VAD tail plus a client debounce (`RESPONSE_DEBOUNCE_S`)
>   before the interviewer may answer — 1.2 s until 2026-08-08, cut to
>   0.6 s by DECISIONS 055 on the operator's field report, so ~1.5 s of
>   quiet (down from ~2.1 s) passes before the request to speak is even
>   sent — chosen so a thinking pause is not cut off. 800 ms remains
>   unreachable as specified even after the cut. The number stays as written until there is an
>   instrument to replace it from data; instrument and replacement both
>   belong to F-13 in v0.6.
> - **Session completion rate ≥ 85% — unmeasured for want of users.** The
>   status fields exist; the denominator does not. Every session so far was
>   run by the developer (`docs/metrics/`), so a rate computed today would
>   be a self-test statistic. It gets computed when real usage exists and
>   F-13 reports it (v0.6).
> - **Paid packages — target qualified, and not met.** Exactly one $49
>   order exists: the operator placed it against live Polar to prove
>   checkout → webhook → provisioning end to end, then refunded it and kept
>   the receipt. That is evidence the payment path works, not a sale.
>   flightcheck has zero external users and zero external paying customers.
>   As originally written a self-test satisfied the row, so it now excludes
>   operator verification orders; the number and the date are unchanged.
> - **What DECISIONS 008 actually said**, since this file restates it two
>   different ways: "the merchant-of-record integration (DECISIONS 004)
>   starts no earlier than v0.3. Each version ships one feature bundle: v0.2
>   interviewer UX, v0.3 report quality, v0.4 session history, v0.5
>   curriculum-lite, then payments." That is a floor of v0.3 and a sequence
>   putting payments after v0.5 — so the note above quotes the floor, and
>   the scope note below ("payments no earlier than v0.5") quotes neither.
>   What happened: payments shipped **as** v0.5 (DECISIONS 017–019), and
>   curriculum-lite moved to v0.6+. 008 now carries its own dated
>   supersede block saying the same.

> 2026-08-04: v0.6 and v0.7 shipped, and four "Measured by" cells moved with
> them. No target number and no deadline changes in this entry. The pattern
> in all four is the same: a cell that named a future release was correct
> when written and was turned false by that release arriving.
>
> - **"This feedback was actually useful" ≥ 80% — the instrument was never
>   built.** The cell read "post-session prompt (instrumented with F-13,
>   v0.6)". F-13 shipped in v0.6 and instrumented three things — session
>   completion rate, package burn-through, and scoring latency. A usefulness
>   prompt is not one of them, and nothing anywhere in the product asks the
>   question: no screen, no route, and no column in any migration. The cell
>   now says the instrument does not exist. It names no release either,
>   because naming one is what produced this correction.
> - **Session completion rate and package utilization — the instrument
>   exists; the users do not.** Both cells pointed at F-13 in v0.6 as work
>   still to come — one saying outright that no report computed the number,
>   the other naming a report that did not exist yet.
>   F-13 computes both. `scorer.api.usage.compute_usage` derives the
>   completion rate from exactly the definition its row gives — `scored` +
>   `insufficient` over the sessions that opened a room — `GET
>   /api/metrics/usage` serves it, and `services/scorer/tools/usage_report.py`
>   renders both against their targets, each next to the counts it came
>   from. What is missing is not the instrument but the sample: flightcheck
>   has zero external users, so any number produced today is a self-test
>   statistic. That is a materially stronger position than the cells were
>   claiming for this repo, and the cells now claim the accurate one.
> - **First-response latency ≤ 800 ms (p50) — F-13 shipped and deliberately
>   did not instrument it.** The 2026-08-03 note above ends "instrument and
>   replacement both belong to F-13 in v0.6". F-13 shipped in v0.6 and
>   declined the job on purpose: it publishes `p50_first_response_s` as
>   `None` with a written reason attached, rather than borrowing the one
>   latency the product does record — which measures how fast the
>   *candidate* answers, not how fast the interviewer does
>   (`services/scorer/src/scorer/api/usage.py`). Publishing the candidate's
>   number under this row's name would have made the row measured and false.
>   The refusal is the right call, and it is recorded here as a refusal
>   rather than restated as a promise against some later version: this
>   metric is uninstrumented, and no release currently carries it. The
>   target number and its original deadline are unchanged.

## Scope

- **v0.1 (2026-08-09):** full loop, single session — intake (JD + resume + LinkedIn PDF) → rubric (shown to user before the interview) → one 20-min S2S session → dual-channel score → report. Live deployed URL; sample report public, no signup.
- **v0.2 (2026-08-16):** 6-session package state (evidence map, asked-questions, recurring weaknesses, delivery profile) → session orchestrator → payments (merchant-of-record) → usage metrics.
- **v1.0 (2026-08-21):** Ready-verdict calibration, demo video, launch notes, unit economics published.
- **v0.4 (added 2026-08-02):** accounts — sign-in with Google or a
  passwordless email link; interviews require sign-in (no anonymous
  sessions, including tests). Public landing page with a demo video, a
  logged-in home (session list, next-session entry, readiness), a pricing
  screen (UI only — payment-provider integration stays with payments,
  DECISIONS 008), and the 6-session package quota enforced end to end.
- **v0.5 (recorded 2026-08-03):** payments — Polar as merchant of record
  (hosted checkout, so the app never renders a card field; a
  signature-verified, replay-safe `order.paid` webhook is the only thing
  that unlocks a package), the trial-then-unlock model ($49 unlocks the
  same package to its six sessions, 30-day window from payment), receipts
  in settings, terms/privacy/refund pages, retention and deletion v0, and
  the abuse, cost, and prompt-injection guards a paid product needs.
  DECISIONS 017–021.
- **v0.6 (recorded 2026-08-04):** operate at scale — the release after which
  the operator can be away for a week. Self-serve account deletion that
  removes recordings before rows and deletes nothing on a partial failure,
  self-serve email change, a rebuilt landing page, and the operator's
  instruments: a real-usage endpoint (`GET /api/metrics/usage`) with the
  report generator that renders it, a dead-letter record for permanently
  failed jobs, and backup/restore written down as a procedure. Plus the
  guards that make being away safe — backoff on every model call with the
  call sites pinned by test, a scoring concurrency and memory limit, a job
  deadline, one live session per package, security headers, capability
  revocation, and prompt-injection refusal at intake with its own gated eval
  suite. DECISIONS 025–030.
- **v0.7 (recorded 2026-08-04):** the design pass — one design system that is
  enforced rather than described (every colour, type step, radius and shadow
  declared once, with a test that walks `app/`, `components/` and `lib/` and
  fails on a raw value), light-only rendering, a report that draws why a
  verdict is what it is against both thresholds, a landing page cut to four
  blocks, and type that scales with the reader. Two rounds of adversarial
  review followed the restyle; what they found is listed with the release
  rather than folded into it. DECISIONS 031.

- **v0.8 (2026-08-04):** one door — sign-in is **Continue with Google**, and
  the passwordless email link is removed. The email link made the product's
  only entrance a message that has to be delivered, on a sender the product
  does not control and whose own documentation calls it rate-limited and
  best-effort; every account it created was one undelivered message away from
  being unreachable, including the accounts that hold paid packages. Google is
  the account these customers already have, it arrives with the address
  verified, and it costs no credential store, no reset flow, no mail template
  and no sender domain. The settings screen loses its change-sign-in-address
  form with it: the address belongs to the Google account now. DECISIONS 036.

- **v0.9 (2026-08-05):** three interface corrections, each recorded here
  before its code. The new-package screen gains a step-by-step visual
  walkthrough beside the LinkedIn PDF upload: the export lives several
  clicks deep in LinkedIn's own menus, and one line of fine print was the
  only guide the screen offered. The package's company identity, the
  favicon mark where the pasted JD URL earns one and the company name
  beside it, appears on every surface that names a package rather than on
  the /packages card alone, and the card's honesty rule travels with it:
  no company in the rubric, nothing rendered, never a placeholder. And the
  top-bar menus dismiss the way menus are expected to, on a click outside
  and on Escape, where today they stay open until their own trigger is
  clicked again; with JavaScript disabled they keep today's
  click-to-toggle behaviour.

- **v0.10 (2026-08-05):** four changes, each recorded here before its
  code. The signed-in product starts moving the way the landing already
  does: a report's score counts up to its value once, the readiness gauge
  sweeps to its position, the progress and session lists enter with the
  landing's one-shot vocabulary, and a status change fades instead of
  teleporting, all inside the motion budget the landing shipped under
  (DECISIONS 031 and 035): transform and opacity only, one pass, settled
  outright under reduced motion. The footer row gains a labeled Feedback
  door beside FAQ, a mailto link to the support address, so no new place
  holds customer data. The product becomes legible to machines as well as
  to people: an llms.txt at the site root, an explicit AI-crawler policy
  in robots.txt, and structured data on /pricing and /faq. And the
  progress screen shows average response latency alongside the other
  delivery trends; it is the number every session report already carries,
  which measures how promptly the candidate answers, so the
  uninstrumented first-response target above is untouched by it.

- **v0.10, judge batch (2026-08-05):** two report corrections, recorded here
  before their code, riding the eval gate at the tag. First, the report's
  emphasis becomes the judge's own: each dimension carries a short key span
  the judge itself marks, verbatim from its rationale, and that span is what
  the report sets apart — today the report emphasises each rationale's first
  sentence by position, a rule that follows the paragraph's structure rather
  than the judge's intent. The positional first-sentence rule remains as the
  fallback for every report that predates the field. Second, each dimension's
  strengths and weaknesses are authored by the judge rather than shipped as
  empty defaults — the pass DECISIONS 016 deferred to an eval-gated release,
  now finished. Reports stored before either change lack the new field and
  carry empty lists, and they must parse and render exactly as they do today.

- **v0.11 (2026-08-05):** the rubric shows its receipts, recorded here
  before its code. Today the compiler grounds every dimension in research
  findings and corpus documents, and nothing requires the job description
  itself to license a dimension — so a research sweep full of generic
  responsible-AI writing can hand an ethics dimension a legitimate-looking
  citation for a role whose JD never asks for it, and the session then
  spends a guaranteed question slot on it. Three changes. Each content
  dimension must now carry jd_evidence, a short verbatim quote from the job
  description proving the role itself demands that dimension, enforced in
  code as an exact substring of the JD the compiler saw; values boilerplate
  and research-only support stop licensing dimensions (research
  corroborates, the JD licenses), while a JD that genuinely leads with a
  topic keeps its dimension at full weight — a licensing rule, not a topic
  ban. A rubric-faithfulness suite joins the release gate: committed JD
  fixtures, including one salted with values-section boilerplate, compile
  live and are checked deterministically, so the failure that motivated
  this change cannot return unnoticed. And /rubric shows each content
  dimension's receipt, the JD sentence that earned it. Rubrics stored
  before the field existed parse and render exactly as they do today.

- **v0.12 (recorded 2026-08-08, pre-code):** the after-the-session
  product — what the customer does between interviews. Four features,
  one batch. **Session coaching:** the session detail grows sub-tabs
  (Report, Transcript, Study). Under each answer in the transcript, a
  coloured check says whether the answer read as strong or as needing
  work; opening it shows a stronger phrasing of the whole answer and a
  short why naming the specific phrases. Every suggestion can be
  bookmarked and rated up or down, and those marks are stored — they are
  the raw material for later analysis of whether the coaching is any
  good. Suggestions are generated text and are labelled as such; the
  transcript itself and every quoted anchor stay verbatim, the same
  contract the report already enforces. Coaching is generated right
  after scoring, never delays or fails a report, and is not produced
  for sessions the eligibility gate refused to score — advice built on
  evidence the product called too thin would be fake coaching. The
  session Study sub-tab collects what was saved plus this session's
  review: what went well, what did not, the expressions worth keeping,
  and the questions from this session the candidate must be able to
  answer, each with a model answer built from the candidate's own best
  material and labelled as generated. **Study tab:** a new top-level
  tab aggregates across the package — every bookmarked expression
  organized by session, and a package-level summary of recurring
  problems, an improvement strategy, and the job's core questions with
  model answers to memorize; exportable as Markdown and PDF, the same
  two-format door the report already has. Built on demand at the
  customer's request and marked stale when new sessions score, rather
  than regenerated silently on every visit. **Dashboard home:** the
  signed-in home stops being a row of dots and starts answering "am I
  getting better" at a glance — overall score trend, per-dimension
  trajectories, and the recurring gaps, composed from the progress
  screen's existing instruments; /progress keeps the detail. **Feedback
  channel:** the footer's Feedback door stops being a mailto (v0.10)
  and becomes a form — a five-star rating in half-star steps plus free
  text, stored, with an operator-only inbox to read and manage what
  arrives. DECISIONS 048–051. (Also in this release, recorded here AFTER its
  code — committed 2026-08-07 — because it is eval infrastructure
  governed by its DECISIONS entries rather than product scope, each of
  which did precede the code: the Morgan naturalness measurement stack — a version-stamped provenance block in every
  metrics document, a synthetic golden clip pinning segmentation, and
  cross-language gates on the interview timing constants. Eval
  infrastructure, DECISIONS 047 and 051.)

- **v0.13 (recorded 2026-08-08, pre-code):** first use of the v0.12
  surfaces reshapes them — the operator in the customer seat (one live
  session plus one disclosed synthetic; DECISIONS 053), both changes
  straight from that field feedback. **Study folds
  into the session.** The global Study tab and its Generate button go
  away: what a customer studies is per session and is already there the
  moment scoring finishes — derived from the coaching artifacts and the
  customer's own bookmarks, so there is nothing to build and nothing to
  go stale. Opening a session now leads with the conversation itself
  (Transcript is the first tab), not the verdict; the report keeps its
  own tab. Each answer bubble carries its check below it, and opening a
  check shows the better answer first, then the why, then what was
  actually said; very short answers are left alone. Bookmarking builds
  the session's study notes: every saved item becomes an
  interviewer-question + answer set, joined by the session's core
  questions with model answers, exportable per session as Markdown or
  PDF in plain question-and-answer form — a wrong-answer notebook a
  candidate can memorize from. **The dashboard becomes readable.** The
  overall-trend bars could collapse into an unreadable smear; every
  rubric trend is now a line chart — a tall overall line as the
  dashboard's opening visual with all six package slots on the axis and
  the scored sessions plotted, plus per-dimension sparklines — in the
  existing pastel accent. DECISIONS 053–054.

- **v0.14 (recorded 2026-08-08, pre-code):** the same day's second
  field pass. Coaching checks open in place (an expanding card under
  the answer, not a popup); the thumbs pair on suggestions retires in
  favor of bookmark plus a structured flag — a reader who distrusts a
  suggestion says why in one tap (misheard, inappropriate, inaccurate
  paraphrase, missing explanation, or their own words), which turns
  distrust into countable coaching-eval data; pressed controls look
  pressed. The session replay strip actually plays (a security-header
  omission had silently blocked it since it shipped), the pastel trend
  area turns translucent so the grid reads through, and the session
  sub-tabs lead with Report again, matching the sessions list's own
  "Report" doorway. DECISIONS 057.

- **v0.15 (recorded 2026-08-08, pre-code):** the sessions stop
  repeating, and the interview learns who is sitting in the chair.
  **Fresh topics, for real this time:** each of a package's six
  sessions now draws different questions from the rubric's own bank —
  no verbatim repeats across the package — the pressure probe rotates
  and aims at the weakest scored dimension from the candidate's own
  history, and from the second session onward the sequence leads with
  what the last report said needs work. Deterministic from the rubric,
  the session number, and the stored history: no model call at session
  start. Shipping this retires the standing honesty caveat (PRD,
  README, landing, llms.txt) that every session runs the same plan —
  the caveat flips only in the release that ships the fix. **The
  person, not just the role:** when a profile document was provided,
  the rubric carries one profile-licensed role-and-company-fit
  dimension — scored, reported, coached, and trended like every other
  dimension, with its own honest receipt on the rubric screen ("this
  bar comes from your own profile") — and the interviewer asks one or
  two personal questions built from the candidate's actual career
  story: why this company, why this role after that career. No profile
  provided means no fit dimension and an unchanged rubric.
  DECISIONS 058–059.

- **v0.16 (recorded 2026-08-09, pre-code):** the front door gets
  lighter, and the free tier changes shape. **A five-minute taste
  replaces the free full session:** the first thing a visitor does is
  type a target company and a role — no job-description hunt — sign
  in, and talk to the interviewer for about five minutes. The quick
  questions are templated from the company and role alone and labeled
  as exactly that: ungrounded, no research pass, honestly distinct
  from the paid JD-grounded interview. Five minutes sits below the
  scoring floor, so the quick interview is never scored and never
  pretends to be — the screen after it shows the public sample report
  framed with the visitor's own company and role, under a plain
  banner: this is a sample; a real package makes every part of it
  personal. This retires the free trial session (the F-24 model):
  the quick interview is now the one free door, registering the real
  JD stays free up to the rubric — the "this is the bar" moment — and
  every full 20-minute scored session is paid. **The home screen
  introduces itself once:** the first arrival at home dims the page
  and walks the features one by one — skippable at every step, shown
  once ever, the product's only auto-opening surface, on purpose.
  DECISIONS 060–061.

- **v0.17 (recorded 2026-08-10, pre-code):** the closed beta gets a
  door key. A CBT access code — one shared code, handed out by the
  operator to the beta group — entered once on a signed-in account
  entitles it to **three full packages**, each with the normal six
  scored 20-minute sessions, without payment. The grant rides the
  existing comp machinery (`comped_at`, DECISIONS 037), never
  `paid_at`, so no revenue that never happened can appear in any
  money query. Every CBT package is born carrying the beta's fixed
  end date as its expiry, so the beta ends on a calendar day instead
  of trailing off — new sessions stop, reports and recordings stay
  readable, exactly like an expired paid window. Redemption is one
  field with honest copy on the signed-in surfaces, rate-limited like
  every input; the code is stored only as a hash, with a redemption
  cap and a kill switch, and the entitlement count survives package
  deletion (the quick-allowance lesson, DECISIONS 060 amendment).
  The metrics posture flips for the first time: CBT participants are
  **real external users** — their sessions count as real usage under
  impression rule ⑦ — while their packages stay visibly non-revenue,
  and `docs/metrics/README.md` says so in the same release.
  DECISIONS 062.

- **v0.18 (recorded 2026-08-10, pre-code):** navigating stops feeling
  like teleporting. Route changes currently swap the whole screen in
  one frame — click, pop, a new world with no thread back to the one
  just left — and the product reads less finished than it is (user
  field report, 2026-08-10). A route-transition layer gives screen
  changes one continuous surface, inside the established motion
  budget (0.3 s, transform and opacity only, no infinite loops, one
  written justification per animation) or as named, justified
  exceptions recorded in DECISIONS; the landing's pink hero cloud
  gains a subtle scroll-linked drift, transform-only and passive; and
  hover/focus feedback appears only where the existing vocabulary
  already grants it. Reduced motion keeps its whole meaning: every
  new transition degrades to the settled state. Deliberately
  untouched: control press scale (declined, DECISIONS 041 — its own
  revisit condition, not this change), the session room, and ambient
  loops. DECISIONS 063.

- **v0.20 (recorded 2026-08-12, pre-code):** the product moves to its
  own address. `flightcheck.coach` — bought 2026-08-12, the exact
  brand name on the one honest TLD that was actually purchasable
  (DECISIONS 065 records what was not) — becomes the canonical
  origin: the one `SITE_URL` constant flips, and every canonical URL,
  OG image, sitemap, and robots line derives from it as they always
  did; the README's live links and the deploy doc follow; the
  vercel.app address keeps serving and redirects to the new origin so
  no existing link breaks. Historical records (release notes, the
  changelog, RETRO) keep the old address where they mention it —
  they describe the past, and the past happened there. Alongside the
  code: the auth provider's redirect allowlist learns the new origin
  BEFORE the flip deploys, and the site enters Google Search Console
  with its sitemap submitted — the beta and every future applicant
  search from here on lands on a real domain. DECISIONS 065.

- **v0.19 (recorded 2026-08-12, pre-code):** the interviewer starts
  ACTING like a real interviewer, not only sounding like one. Three
  instruction-driven behaviors join the interviewer's brief, all
  grounded in what the package already knows and none of them a new
  model call: commentary that is aware of the company and role the
  rubric actually carries; reactions that engage the substance of the
  candidate's last answer before moving on, beyond rubric probing;
  and a closing whose register reflects how the interview actually
  went. Plus **adaptive warmth**: past the session's midpoint, if the
  candidate has CLEARLY been answering strongly, the interviewer may
  loosen briefly — a short laugh, one light aside — then return to
  questions; anything less than clearly strong keeps the professional
  register, because a wrongly-warm interviewer is a false "you're
  doing well" signal. The one line this never crosses: adaptivity
  changes WHAT is said, never WHEN the session ends — the paid
  20-minute budget, the closing window, and the exact closing
  sentence stay exactly as gated. Quick interviews are untouched.
  This moves the instructions lever the naturalness suite tracks;
  the move is recorded in that suite's worklog before any baseline
  exists to poison. DECISIONS 064.

> 2026-08-02: v0.4 scope added above — accounts move ahead of payments
> because login-gated interviews protect session integrity and per-session
> cost, and the dashboard is what makes a 6-session package usable. The
> original v0.2 line bundled payments; that part remains governed by
> DECISIONS 008 (payments no earlier than v0.5).

> 2026-08-03: the complete-webapp batch fills v0.4's account shell with the
> full screen inventory — home, sessions archive, session detail with
> verbatim transcript and audio replay, progress trends, rubric (the bar
> made visible; the question bank deliberately withheld), packages
> overview, and settings. All screens live behind login-scoped URLs, with
> token links demoted to claim/redirect addresses, and scoring gains an
> eligibility gate: sessions below the evidence floor are not scored and
> do not burn the slot. Details: DECISIONS 012–016.

> 2026-08-03: the v0.5 entry above was written on release day, after its
> code shipped — late by this repo's own PRD-before-code rule, and recorded
> rather than backdated. v0.5 is also not the bundle the published plan
> named: payments took the slot and curriculum-lite moved to v0.6+, while
> the v0.3 and v0.4 bundles (report quality, accounts, the signed-in
> webapp, session history, progress) shipped inside this release without
> ever being tagged — the tags are v0.1.0, v0.2.0, and this one. v0.1 and
> v0.2 themselves shipped ahead of the dates listed above, on 2026-07-26
> and 2026-08-01. The DECISIONS 008 correction is in the 2026-08-03 note
> under Success metrics.

> 2026-08-04: the v0.6 and v0.7 entries above were written on tag day, after
> their code shipped and after both batches were already deployed — late by
> this repo's PRD-before-code rule, the same way v0.5's entry was, and
> recorded rather than backdated. The rule is not being restated to
> accommodate them: PRD-before-code means the contract precedes the
> implementation, these two entries do not meet it, and that is a debt this
> document carries rather than a bar it moves. What the rule still holds
> against, without qualification, is the first commit: `PRD.md` preceded the
> first source file.

## Non-goals (v1)

Case-interview exhibits and calculation grading; L1-specific pronunciation curriculum; interviewer difficulty dial; LinkedIn scraping (official PDF export instead); any STT→LLM→TTS cascade — permanently out, not deferred: transcription destroys the delivery signal this product sells.

## Architecture (summary)

Web app (Next.js/Vercel: intake, WebRTC session room, reports, auth, payment webhooks) · scoring worker (Python/FastAPI on Railway: rubric compiler with evidence-grounded RAG, DSP delivery metrics, audio-native + content judges, report compiler) · Supabase (state, audio storage, auth). Realtime path and scoring path are decoupled: the live interviewer provider and the scoring models are chosen independently. Provider selection is data-driven — see `evals/reports/2026-08-02-provider-bakeoff.md` and `DECISIONS.md`.

## Quality gates

Every release passes the non-negotiables in `CLAUDE.md` and the eval suites in `evals/` (`cd services/scorer && uv run scorer-evals`, exit 0), with the run of record committed under `evals/reports/`. A release with a failing gate does not ship; scope shrinks instead.

> 2026-08-03: this section used to point at a checklist in `CLAUDE.md` that has
> never been in that file — it holds the numbered non-negotiables — so the
> pointer now names what a reader can actually open.
