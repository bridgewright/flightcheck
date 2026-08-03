# PRD — flightcheck

*Committed before the first line of source code, on purpose. This document is the contract; the code follows it.*

## Problem

Non-native English speakers preparing for interviews at global tech companies have no way to answer three questions before the real interview: **Would I pass today? What exactly is missing? Is it my content or my delivery?**

Generic AI voice chat (free) can converse but cannot judge against a specific job's bar, cannot track growth across sessions, and — because cascade pipelines transcribe speech to text before the model sees it — cannot hear hesitation, fillers, or intonation at all. Human interview coaches can, at $70–150/session.

## Product

Paste the job description you are applying to. flightcheck researches how that company and role actually interview (public interview experiences, hiring guides, the JD itself), compiles an evidence-grounded rubric for that exact role, interviews you about it by voice — a native speech-to-speech conversation that feels like a real interviewer — scores every session on two channels (content from the transcript, delivery from the raw audio), and tells you honestly: **Ready / Approaching / Not ready**, what is missing, and what to drill next. Sessions repeat with fresh topics until you are ready.

## Users

- Primary: non-native English speakers (Korean first market) interviewing at global tech companies.
- First verticals with quality guarantees: AI deployment / forward-deployed / technical PM roles. The pipeline is role-agnostic; verticals expand with validated rubric corpora.

## Package (pricing)

One JD = one package: **$49 · 30 days · 6 sessions × 20 min · per-session reports · final Ready verdict.** No subscription. The first session on a package is a free trial; $49 unlocks the same package — same JD, same rubric — to its full six sessions, and the 30-day window starts at payment (new starts only; reports stay readable). Honest-verdict policy: if not ready by session 6, the product says so — never a courtesy pass.

> 2026-08-03: price restated from ₩89,000 to $49 USD (single global price
> story) and the trial-then-unlock model added with v0.5 payments — full
> options-and-rejections trail in [DECISIONS.md #018](DECISIONS.md) and
> [#019](DECISIONS.md).

## Success metrics (targets set in advance — v1.0 = 2026-08-21)

| Metric | Target | By | Measured by |
| --- | --- | --- | --- |
| Judge–human scoring agreement (Cohen's κ) | ≥ 0.8 | v1.0 | not built — no suite computes κ. Interim proxy only: on the three golden triplets, the human blind rankings (`evals/suites/rubric_discrimination/manual/`) and the judge each match the key 3/3 — ordering agreement at N=3, not κ |
| "This feedback was actually useful" (post-session) | ≥ 80% | v1.0 | post-session prompt (instrumented with F-13, v0.6) |
| First-response latency, user stops → interviewer speaks (p50) | ≤ 800 ms | v0.2 | not built — nothing times the interviewer side, in the web app or the worker. The scorer's `avg_response_latency_s` is the opposite direction (interviewer end → candidate start) and a mean, so it cannot stand in |
| Session completion rate (no mid-session abandonment) | ≥ 85% | v0.2 | session status (`scored` + `insufficient`) against sessions that opened a room (`secret_mints`); no report computes it yet — F-13, v0.6 |
| Package utilization (sessions actually used, of 6) | ≥ 4 | v1.0 | package burn-through report (F-13, v0.6) |
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
>   contradict a later decision.** Nothing instruments the interviewer side
>   of a turn. DECISIONS 009 then made the wait deliberate: a 900 ms
>   server-VAD tail plus a 1.2 s client debounce (`RESPONSE_DEBOUNCE_S`)
>   before the interviewer may answer, so at least ~2.1 s of quiet passes
>   before the request to speak is even sent — chosen from the measured
>   bake-off precisely so a thinking pause is not cut off. 800 ms is
>   unreachable as specified. The number stays as written until there is an
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

## Non-goals (v1)

Case-interview exhibits and calculation grading; L1-specific pronunciation curriculum; interviewer difficulty dial; LinkedIn scraping (official PDF export instead); any STT→LLM→TTS cascade — permanently out, not deferred: transcription destroys the delivery signal this product sells.

## Architecture (summary)

Web app (Next.js/Vercel: intake, WebRTC session room, reports, auth, payment webhooks) · scoring worker (Python/FastAPI on Railway: rubric compiler with evidence-grounded RAG, DSP delivery metrics, audio-native + content judges, report compiler) · Supabase (state, audio storage, auth). Realtime path and scoring path are decoupled: the live interviewer provider and the scoring models are chosen independently. Provider selection is data-driven — see `evals/reports/2026-08-02-provider-bakeoff.md` and `DECISIONS.md`.

## Quality gates

Every release passes the non-negotiables in `CLAUDE.md` and the eval suites in `evals/` (`uv run scorer-evals`, exit 0), with the run of record committed under `evals/reports/`. A release with a failing gate does not ship; scope shrinks instead.

> 2026-08-03: this section used to point at a "12-point checklist in
> `CLAUDE.md`". No such checklist has ever been in that file — it holds the
> numbered non-negotiables — so the pointer now names what a reader can
> actually open.
