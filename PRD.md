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

One JD = one package: **₩89,000 · 30 days · 6 sessions × 20 min · per-session reports · final Ready verdict.** No subscription. Honest-verdict policy: if not ready by session 6, the product says so — never a courtesy pass.

## Success metrics (targets set in advance — v1.0 = 2026-08-21)

| Metric | Target | By |
| --- | --- | --- |
| Judge–human scoring agreement (Cohen's κ) | ≥ 0.8 | v1.0 |
| "This feedback was actually useful" (post-session) | ≥ 80% | v1.0 |
| First-response latency, user stops → interviewer speaks (p50) | ≤ 800 ms | v0.2 |
| Session completion rate (no mid-session abandonment) | ≥ 85% | v0.2 |
| Package utilization (sessions actually used, of 6) | ≥ 4 | v1.0 |
| Paid packages | ≥ 1 | 2026-08-23 |

Changes to targets are recorded here with date and reason — never silently.

## Scope

- **v0.1 (2026-08-09):** full loop, single session — intake (JD + resume + LinkedIn PDF) → rubric (shown to user before the interview) → one 20-min S2S session → dual-channel score → report. Live deployed URL; sample report public, no signup.
- **v0.2 (2026-08-16):** 6-session package state (evidence map, asked-questions, recurring weaknesses, delivery profile) → session orchestrator → payments (merchant-of-record) → usage metrics.
- **v1.0 (2026-08-21):** Ready-verdict calibration, demo video, launch notes, unit economics published.

## Non-goals (v1)

Case-interview exhibits and calculation grading; L1-specific pronunciation curriculum; interviewer difficulty dial; LinkedIn scraping (official PDF export instead); any STT→LLM→TTS cascade — permanently out, not deferred: transcription destroys the delivery signal this product sells.

## Architecture (summary)

Web app (Next.js/Vercel: intake, WebRTC session room, reports, auth, payment webhooks) · scoring worker (Python: rubric compiler with evidence-grounded RAG, DSP delivery metrics, audio-native + content judges, report compiler) · Supabase (state, audio storage, auth). Realtime path and scoring path are decoupled: the live interviewer provider and the scoring models are chosen independently. Provider selection is data-driven — see `evals/reports/2026-08-02-provider-bakeoff.md` and `DECISIONS.md`.

## Quality gates

Every release passes the 12-point checklist in `CLAUDE.md` and the regression eval suite in `evals/`. A release with a failing gate does not ship; scope shrinks instead.
