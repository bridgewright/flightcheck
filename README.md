# flightcheck

**A pre-flight check for your English interview.** Paste the JD you're applying to; flightcheck interviews you by voice against that role's actual bar, scores both *what you said* (transcript) and *how you said it* (raw audio — native speech-to-speech, no transcription in the loop), and tells you honestly whether you're ready.

## v0.1 — live

- **App:** https://flightcheck.vercel.app
- **Sample report (no signup):** https://flightcheck.vercel.app/sample-report
  — a real practice session, anonymized

![flightcheck demo: paste a JD, preview the cited rubric, take the voice interview, read the honest report](docs/demo.gif)

### Quickstart

1. Open https://flightcheck.vercel.app/new and paste a job description or its URL;
   optionally attach a resume PDF and a LinkedIn "Save to PDF" export
   (no scraping — DECISIONS #003).
2. Wait for the rubric preview — 5-8 weighted dimensions, every one citing
   its sources — then press Start session and take the 20-minute voice
   interview in the browser (25-minute hard cut).
3. When scoring finishes, the report shows the verdict
   (not ready / approaching / ready), per-dimension evidence, delivery
   metrics, and concrete drills — honestly, including "not ready yet".

Release notes: [docs/releases/v0.1.md](docs/releases/v0.1.md). Architecture
(system diagram + data flow): [docs/architecture.md](docs/architecture.md).
Deploy runbook: [docs/deploy.md](docs/deploy.md).

> **Status: v0.1.** Built in public. PRD was committed before the first line of code — [read it](PRD.md). The S2S provider bake-off that picked the interviewer and scoring models is measured, not guessed ([report](evals/reports/2026-08-02-provider-bakeoff.md)); the release-gate eval numbers are committed verbatim ([2026-07-26 gate run](evals/reports/2026-07-26-v01-gate.md)).

## Why not just ChatGPT voice?

1. **A verdict, not a chat** — an evidence-grounded rubric compiled from your target JD and real interview experiences for that company and role, with behaviorally-anchored scoring.
2. **Delivery is scored from raw audio** — hesitation, fillers, hedging intonation. Cascade pipelines erase these before the model ever hears them.
3. **Growth across sessions** *(v0.2, planned)* — evidence map, recurring-weakness tracking, fresh questions every time, until Ready. v0.1 ships one baseline session per package.

## Roadmap

v0.1 full single-session loop — shipped 2026-07-26 → v0.2 will add multi-session packages, payments, and per-session cost metering → v1.0. See [CHANGELOG.md](CHANGELOG.md); real-user metrics land with v0.2 ([docs/metrics/](docs/metrics/)).

MIT · Built AI-natively — see [CLAUDE.md](CLAUDE.md) · Decisions logged in [DECISIONS.md](DECISIONS.md) · Patterns in [PLAYBOOK.md](PLAYBOOK.md) · Honest retros in [RETRO.md](RETRO.md)
