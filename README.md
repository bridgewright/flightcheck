# flightcheck

**A pre-flight check for your English interview.** Paste the JD you're applying to; flightcheck interviews you by voice against that role's actual bar, scores both *what you said* (transcript) and *how you said it* (raw audio — native speech-to-speech, no transcription in the loop), and tells you honestly whether you're ready.

## v0.1 — live

> **Operator TODO (pre-push, release-blocking):** replace every
> `PENDING-DEPLOY-URL` below with the Vercel production URL from the deploy
> runbook ([docs/deploy.md](docs/deploy.md), section 3), then delete this note.
> The URL exists only after the runbook's deploy steps run, so this section
> ships with an explicit placeholder rather than a made-up address.

- **App:** PENDING-DEPLOY-URL
- **Sample report (no signup):** PENDING-DEPLOY-URL/sample-report

### Quickstart

1. Open PENDING-DEPLOY-URL/new and paste a job description or its URL;
   optionally attach a resume PDF and a LinkedIn "Save to PDF" export
   (no scraping — DECISIONS #003).
2. Wait for the rubric preview — 5-8 weighted dimensions, every one citing
   its sources — then press Start session and take the 20-minute voice
   interview in the browser (25-minute hard cut).
3. When scoring finishes, the report shows the verdict
   (not ready / approaching / ready), per-dimension evidence, delivery
   metrics, and concrete drills — honestly, including "not ready yet".

Release notes: [docs/releases/v0.1.md](docs/releases/v0.1.md). Deploy
runbook: [docs/deploy.md](docs/deploy.md).

> **Status: v0.1.** Built in public. PRD was committed before the first line of code — [read it](PRD.md). The S2S provider bake-off that picked the interviewer and scoring models is measured, not guessed ([report](evals/reports/)).

## Why not just ChatGPT voice?

1. **A verdict, not a chat** — an evidence-grounded rubric compiled from your target JD and real interview experiences for that company and role, with behaviorally-anchored scoring.
2. **Growth across sessions** — evidence map, recurring-weakness tracking, fresh questions every time, until Ready.
3. **Delivery is scored from raw audio** — hesitation, fillers, hedging intonation. Cascade pipelines erase these before the model ever hears them.

## Roadmap

v0.1 full single-session loop (2026-08-09) → v0.2 packages + payments (08-16) → v1.0 (08-21). See [CHANGELOG.md](CHANGELOG.md).

MIT · Built AI-natively — see [CLAUDE.md](CLAUDE.md) · Decisions logged in [DECISIONS.md](DECISIONS.md)
