# S2S Provider Bake-off — 2026-08-02

_Dateline: `2026-08-02` is the milestone slot this report closes, not the day
it was run. DECISIONS #002 was opened 2026-07-25 "resolves 2026-08-02", and
the report generator (`scorer.bakeoff.report`) writes that filename. The runs,
the decision, and this file's commit (`2beda15`) are all 2026-07-25 — eight
days early. Every other file in `reports/` is named for the day it was
committed; this one is the exception, and it keeps the slot name because the
generator writes that path and several documents link it._

Method: DECISIONS.md #002. Automated runs via `make bakeoff-*`; manual sessions per
`evals/suites/bakeoff/manual_protocol.md`. Criteria ordered by lethality:
stability > latency > interruption > persona > (scoring channel) audio discrimination.

## Automated metrics

| provider | mode | turns | attempted | p50 ms | p95 ms | disconnects | errors | resumptions | minutes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai | latency | 4 | 4 | 751.24204151507 | 897.0397814919124 | 0 | 0 | 0 | 2.87 |
| openai | stability | 32 | 32 | 842.9006869846489 | 1124.4379710478825 | 0 | 0 | 0 | 22.53 |
| gemini | latency | 4 | 4 | 1856.4546874986263 | 3200.3663125433377 | 0 | 0 | 0 | 2.79 |
| gemini | stability | 27 | 32 | 1807.636374986032 | 3440.0437749980483 | 0 | 0 | 2 | 22.37 |

## Manual session ratings (1–5)

| provider | session | persona_adherence | pressure_persistence | interruption_naturalness | english_only_discipline | notes |
| --- | --- | --- | --- | --- | --- | --- |
| gemini | 1 | 5 | 4 | 3 | 0 | Session lasted only 4m24s — well inside the ~10-min connection window, so the unresponsiveness is NOT the session cap. Perceived turn gap 10-20s throughout (vs 1.8s scripted measurement with manual turn signals; first response ~10s after greeting); final answer got 20s+ of silence despite repeated prompts — session abandoned at 4m24s. Root cause unresolved: either Gemini-side end-of-speech detection/response failure, or a defect in our browser Gemini audio path — flagged for investigation before any Gemini live-path use. Voice notably more human than OpenAI; follow-ups more context-aware. Candidate felt calmer speaking (no barge-in risk) but the dead air between turns breaks interview rhythm entirely. |
| openai | 1 | 5 | 2 | 2 | 5 | Voice pace/quality fine but reads as scripted: follow-ups feel checklist-driven rather than listening; too-clean delivery (no breathing/pauses) reduces interviewer realism. Mid-sentence 2s pause triggered turn-taking (0.9s threshold insufficient for thinking pauses). Post-answer 3s silence: moved on quickly rather than holding. Immersion not broken overall; 'not human, but not distracting.' |

## Scoring-channel audio discrimination

| model | trials | ranking accuracy | api failures | parse failures |
| --- | --- | --- | --- | --- |
| openai/gpt-audio | 12 | 0.50 | 0 | 0 |
| gemini/gemini-2.5-flash | 12 | 0.92 | 0 | 0 |

## Decision

_Decided 2026-07-25 (eight days early); mirrored to DECISIONS.md #002:_
- Live interviewer provider: **OpenAI Realtime** — won stability (32/32 turns, single session) and latency (p50 751-843 ms; conversational rhythm held in live browser use)
- Scoring-channel audio model: **Gemini 2.5 Flash** — 0.92-1.00 delivery-ranking accuracy vs 0.50 (chance 0.17); scoring is file-based, unaffected by live-path issues
- Key trade-off accepted: giving up Gemini's more context-aware probing and more human voice in the live seat; mitigations queued (rubric-grounded session plans, semantic_vad, per-user silence calibration)
