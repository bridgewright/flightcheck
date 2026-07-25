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
**Choice:** pending — recorded here with data on 2026-08-02; full data in `evals/reports/2026-08-02-provider-bakeoff.md`.
**Revisit when:** either provider ships a major realtime revision, or observed session-failure rate exceeds 2%.

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
