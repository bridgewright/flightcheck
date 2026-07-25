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

**Context:** Korean solo builder; Stripe unavailable for KR merchants; domestic PGs require business registration.
**Choice:** merchant-of-record checkout (Lemon Squeezy or Polar) for v0.x — handles global cards and tax as the seller of record; webhook provisions packages.
**Revisit when:** domestic volume justifies business registration + a Korean PG.

## 005 — Bake-off voice clips stay out of git (2026-07-25)

**Context:** the audio-discrimination probe uses recordings of a real person's voice (controlled fluent/filler/hesitant samples).
**Choice:** clips are git-ignored; only derived metrics and rankings are committed.
**Why:** a public repo is forever; biometric-adjacent personal data doesn't belong in it. Reproducibility is preserved via the recording protocol doc.
