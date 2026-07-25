# flightcheck

**A pre-flight check for your English interview.** Paste the JD you're applying to; flightcheck interviews you by voice against that role's actual bar, scores both *what you said* (transcript) and *how you said it* (raw audio — native speech-to-speech, no transcription in the loop), and tells you honestly whether you're ready.

> **Status: pre-v0.1.** Built in public. PRD was committed before the first line of code — [read it](PRD.md). Current phase: S2S provider bake-off ([live report](evals/reports/)).

## Why not just ChatGPT voice?

1. **A verdict, not a chat** — an evidence-grounded rubric compiled from your target JD and real interview experiences for that company and role, with behaviorally-anchored scoring.
2. **Growth across sessions** — evidence map, recurring-weakness tracking, fresh questions every time, until Ready.
3. **Delivery is scored from raw audio** — hesitation, fillers, hedging intonation. Cascade pipelines erase these before the model ever hears them.

## Roadmap

v0.1 full single-session loop (2026-08-09) → v0.2 packages + payments (08-16) → v1.0 (08-21). See [CHANGELOG.md](CHANGELOG.md).

MIT · Built AI-natively — see [CLAUDE.md](CLAUDE.md) · Decisions logged in [DECISIONS.md](DECISIONS.md)
