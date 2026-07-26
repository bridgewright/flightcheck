# PLAYBOOK — reusable patterns from building flightcheck

Patterns that survived contact with real APIs, real audio, and real eval
numbers. Everything here is written from the shipped v0.1 implementation —
file paths are real, numbers are from recorded runs, and anything not yet
shipped is labeled as planned. See [RETRO.md](RETRO.md) for the failures that
produced these patterns.

---

## Chapter 1 — Compiling expert-grade interview rubrics without fine-tuning

The problem: score interview answers at the standard of an experienced
interviewer for a specific role at a specific company — without training a
model, and provably (a gate, not vibes).

The shipped compile path is
`services/scorer/src/scorer/api/pipeline.py::compile_package`:
intake → grounded research sweep → BARS rubric compile → validation gate.
Five patterns make it work.

### 1.1 Ground every rubric in a per-JD research sweep, and enforce citations in code

`services/scorer/src/scorer/research/sweep.py` runs a two-step sweep per JD:

1. **Grounded prose calls** — one Gemini call per query with the
   `google_search` tool, harvesting citations from `grounding_metadata`.
2. **One structuring call** — the concatenated prose is structured with a
   pydantic `response_schema` (no tools).

Two hard-won constraints shaped this:

- The `google_search` tool and `response_schema` **cannot be combined** in a
  single `generate_content` call (measured during the W1 bake-off). Hence the
  two-step shape.
- The structuring model's own `citations`/`queries` fields are **discarded**;
  only citations harvested from grounding metadata survive. The model that
  formats the findings can never invent a source.

Downstream, `services/scorer/src/scorer/rubric/compiler.py` makes citation a
schema-level requirement: every rubric dimension must cite at least one
source (a research citation URL copied verbatim, or a private corpus doc as
`corpus://<doc_id>`), and pydantic validation on the `Rubric` model
(`services/scorer/src/scorer/schemas.py`) is the gate of record — a
citation-less dimension is a `ValidationError`, not a style issue.

**Caveat (v0.1, disclosed in the release notes):** grounded-search citations
are captured at compile time as Google grounding *redirect* URLs, which can
expire. The citation title carries the publisher domain, so the source stays
identifiable; resolving redirects to durable publisher URLs is planned.

### 1.2 BARS anchors: make the model score behavior, not impressions

Every dimension carries exactly three behaviorally-anchored rating-scale
(BARS) anchors — observable answer behavior for scores 1, 3, and 5,
question-independent by rule (`compiler.py`, `_RULES`). The content judge
(`services/scorer/src/scorer/content/judge.py`) then scores **anchor-first**:
compare the answer against the score-5 anchor, name any shortfall, and only
then assign a number. This is what broke the judge's "coverage scoring"
failure mode (see 1.4): impression scoring saturates; behavior-vs-anchor
comparison discriminates.

### 1.3 Private evidence corpus + few-shot re-injection

The compiler prompt carries excerpts from a private corpus of interview
evidence and up to two few-shot example rubrics
(`services/scorer/src/scorer/rubric/corpus.py`; format documented in
`services/scorer/corpus/README.md`). The few-shots are human-corrected
`Rubric` JSON documents — compiled rubrics that a human reviewed and fixed,
fed back as format-and-quality references.

Honest scope note: the *mechanism* (corpus sync from a private bucket,
few-shot loading and prompt injection) is shipped in v0.1; the correction
*loop* is manual — an operator curates the corrected rubrics into the bucket.
Making that a recurring flywheel is v0.2 work. The corpus content itself is
never committed (workspace confidentiality rule; the public repo carries only
the format README and one neutral example doc).

### 1.4 The golden-triplet discrimination gate — and why it earned its keep

You cannot claim "expert-grade scoring" without a falsifiable check. Layer 1
(`services/scorer/src/scorer/evals_l1/golden.py`, suite in
`evals/suites/rubric_discrimination/`) works like this:

- For selected rubric dimensions, generate a question plus three synthetic
  answers: strong (score-5 behavior), borderline (3), weak (1).
- **Generator vendor != judge vendor** (OpenAI generates, Gemini judges) to
  block self-preference bias.
- A **human blind-ranks** shuffled A/B/C sheets (`manual/`, answer keys
  segregated in `manual/keys/`) before any judge run is trusted. Protocol
  rule: when human and judge disagree, trust the human and fix the judge.
- The judge must order all three strictly: strong > borderline > weak.
  Accuracy gates the release against `evals/baselines.json` (min 0.8) via
  `uv run scorer-evals` (`services/scorer/src/scorer/evals_l3/regression.py`).

This gate caught a real, invisible-in-production defect during release prep.
The measured iteration (full detail in
[evals/reports/2026-07-26-v01-gate.md](evals/reports/2026-07-26-v01-gate.md)
and [RETRO.md](RETRO.md)):

| Judge iteration | L1 accuracy |
| --- | --- |
| Original batched all-dimension judge | 0.0 |
| Prompt-only fixes (calibration language, checklist cap, anchor-first + temperature 0 + seed) | 0.33 → 0.0 → 0.33 (plateau) |
| Redesign: one focused call per dimension, anchor-first + precision rules, mean of 3 seeded samples | 1.0 on three consecutive runs |

The reusable lesson: batched multi-dimension scoring created a halo that
saturated the responsive dimension at 5.0, and single LLM calls were **not
reproducible even at temperature 0 with a fixed seed** — score flips larger
than the true strong/borderline separation. The fix is variance reduction of
the measured quantity (focused calls, sample mean), not moving the goalposts:
the eval data, metric definition, and committed 0.8 baseline were never
touched. Caveat stated wherever the number is claimed: N=3 triplets.

### 1.5 Validation-retry, not prayer

`compile_rubric` retries exactly once on `ValidationError`, appending the
validation error text so the model can repair its own output; a second
failure raises. Structured-output quality problems become typed, visible
failures (`RubricCompileError` → package status `failed`, surfaced honestly
in the UI) instead of malformed rubrics reaching users.

---

## Chapter 2 — Scoring delivery from raw audio

The problem: score *how* something was said — hesitation, fillers, pace,
hedging intonation — which transcription destroys before a text model ever
sees it (DECISIONS.md #001: native speech-to-speech only; the cascade was
rejected pre-build as a capability boundary, not a quality tradeoff).

### 2.1 Two layers: deterministic DSP as ground truth, audio-LLM as interpreter

- **Layer A — DSP, no LLM** (`services/scorer/src/scorer/delivery/dsp.py`):
  every number is reproducible from the audio samples and the transcript
  segmentation alone — WPM timeline, filler counts against a config lexicon,
  silence events >= 1s, response latency, f0 variance. This module is the
  delivery channel's ground truth by design.
- **Layer B — audio-native judge**
  (`services/scorer/src/scorer/delivery/judge.py`): one file-based Gemini
  call on the actual WAV, with the DSP metrics injected into the prompt as
  measured fact and the rubric's delivery BARS anchors verbatim. The judge
  adds what DSP cannot measure (what the silences *sound* like, trailing
  off, hedging intonation) and must cite **timestamped observations**.

Post-validation in code, not in the prompt: observations outside the real
audio duration are dropped (duration via `soundfile.info`), scores for
non-delivery dimensions are dropped, and when the judge contradicts the DSP
numbers the conflict is **flagged on the report**, never hidden.

### 2.2 Controlled-triplet validation with a real result

Layer 3 (`services/scorer/src/scorer/evals_l3/delivery_check.py`, clip
protocol in `evals/suites/delivery_discrimination/clips/README.md`) records
three takes of the *same answer* — fluent / filler-loaded / hesitant — so
content is held constant and only delivery varies. Two checks per triplet:

1. **DSP separability:** fluent must have strictly fewer silence events than
   hesitant.
2. **Judge discrimination:** the audio judge must score
   fluent > hesitant and fluent > filler, strictly.

v0.1 recorded result (2 triplets, committed in
[evals/reports/2026-07-26-v01-gate.md](evals/reports/2026-07-26-v01-gate.md)):
DSP separability 2/2, judge accuracy 1.0 against a 0.8 baseline. The earlier
W1 bake-off measured the same discrimination shape across vendors on
controlled clips: Gemini 0.92–1.00 ranking accuracy vs 0.50 for gpt-audio
(chance = 0.17), which is why Gemini scores and OpenAI interviews
(DECISIONS.md #002).

The voice clips themselves are gitignored (DECISIONS.md #005 — a public repo
is forever; biometric-adjacent data never enters it). Reproducibility comes
from the committed recording protocol, not committed audio.

### 2.3 Pattern summary

- Never let an LLM be the only measurement — pair it with a deterministic
  layer and flag disagreements instead of averaging them away.
- Validate LLM outputs against physical reality in code (timestamps within
  audio duration, quotes verified against the transcript in
  `content/judge.py` — fabricated quotes are dropped and flagged).
- Prove discrimination on controlled inputs where the ground truth is known
  by construction, before trusting any score on real inputs.
- Keep model IDs in config (`services/scorer/config/product.toml`) —
  providers drift, and the eval gate exists to catch drift before users do.

### Shipped in v0.1 vs planned

| | Status |
| --- | --- |
| Grounded sweep + cited BARS compile + validation gate | shipped |
| Golden-triplet L1 gate with human blind-rank calibration | shipped (N=3 triplets) |
| DSP + audio-judge dual layer with conflict flagging | shipped |
| L3 controlled-triplet gate | shipped (2 triplets; DSP separability recorded, not yet baselined) |
| Few-shot correction as a recurring flywheel | planned (v0.2 — mechanism shipped, loop manual) |
| Durable publisher citation URLs (resolve grounding redirects) | planned (v0.2) |
| Larger eval N, per-trial score recording for passing trials | planned (v0.2) |
