# Morgan naturalness worklog

Newest first. Two entry kinds: **Round N** records a bar discussion
(question on the table, positions and evidence, resolution, follow-ups);
**Cycle cNN** records one loop cycle (one lever, one run, verdict). The
bar itself lives in `bar.md`; this file is how it got that way.

Discussions happen in Korean between the operator and the controller
session; entries here are the English distillation, written the day the
discussion happens.

---

## 2026-08-08 — Round 1 (opening): experience first, and how bands get set

- Question on the table: the operator redirected the bar review before
  it reached any axis — defining evals IS defining the customer
  experience, so the discussion must start from "what state do we want
  the customer in", then derive observable behaviors, then metrics,
  then bands. The axes become instruments serving that definition, not
  the definition itself. Alongside it, two method questions: how is a
  band actually set, and does this need a golden dataset?
- Resolutions:
  - **Band-setting method.** (1) Measure the AVM reference recordings
    with the same pipeline — "natural" becomes numbers with provenance.
    (2) A band is the AVM number ± tolerance ± PRODUCT JUDGMENT, never
    the raw number: transcript timestamps carry jitter; the sample is
    tiny; and AVM is a chat partner while Morgan is an interviewer, so
    some axes must deviate from AVM on purpose (an interviewer holds
    less air, restrains fillers, asks strictly one question). Every
    deliberate deviation is recorded here with its reason. (3) Measure
    the frozen Morgan baseline with the same pipeline; the per-axis gap
    map picks which lever to pull first. (4) One lever per cycle so
    causality stays readable.
  - **The golden dataset has three frozen parts**: the AVM reference
    set (the anchor, one recording held out as an overfitting alarm on
    our own judgment), the Morgan baseline set (existing session
    recordings, re-scored every cycle as trend line and judge-drift
    canary), and the per-cycle fresh recordings (the only new data each
    cycle). A fourth appears when the judge axis turns on:
    operator-rated transcripts to calibrate judge-human agreement.
  - **Reference recordings are operator-with-AVM, not AVM-with-AVM.**
    The bands describe human-to-AI turn-taking; two AVM instances
    produce machine-to-machine rhythm no human session can exhibit,
    and the candidate side must match the Morgan baseline's speaker
    for ratios to compare. Answer quality is irrelevant — every axis
    reads the interviewer side. Protocol + paste-ready AVM role
    prompts pinned in `reference-protocol.md` (three recordings, 5–10
    minutes, r3 held out).
- **Experience definition agreed (operator-authored).** The product's
  north star is REMOVING THE UNCERTAINTY around English interviews for
  non-native speakers — belief that "preparing with this is enough."
  The voice agent's piece: "that felt like interviewing with a real
  interviewer." That decomposes into "sounds like a real person"
  (this suite's whole scope) and "acts like a real interviewer"
  (company-aware commentary, adaptive warmth/pacing — instruction-side,
  split to its own feature, out of this suite, later a recorded
  lever). bar.md section 1 rewritten to lead with this.
- **Axes reorganized into four families** (rhythm / texture /
  structure / holistic), one table, eleven entries. Speech rate
  (`morgan_wpm_overall`) promoted to axis 2.3 at zero measurement cost
  (already computed and stamped). "Built on my answer" and
  "acknowledges, then asks" are named JUDGE CRITERIA rather than
  metrics — lexical proxies reward parroting and get gamed. The judge
  rubric, when authored, must include them plus silence-respect, and
  must not penalize warmth.
- **Operating principles written down (bar.md section 5)** after
  studying eval-driven-development practice (Fractional AI's
  dimensional-evals and evals-as-instrument-panel writing, plus the
  EDD-as-TDD framing): dimensional never aggregate; deterministic
  first, judge last; instrument panel, not a gate; determinism over
  averaging (pins instead of reruns — temp 0, frozen transcripts,
  provenance stamps); a field failure becomes a case; the evaluators
  are themselves evaluated; one lever, one run, one entry. The suite
  already practiced these; naming them is what makes them survivable.
- **Measurement discipline shipped same day (F-70, item 0 of this
  round):** the provenance stamp (transcription model, DSP constants
  version, overlap floor, cache-vs-fresh) rides every metrics
  document; the golden segmentation regression is armed with pins
  CONFIRMED by a live transcription pass; and the three-way
  `silence_duration_ms` duplicate plus the interviewer model id are
  now twin-gated across the language boundary. The ruler is versioned
  before the first band is measured — the order the outside comment
  argued for, adopted.

## 2026-08-07 — Round 0: the loop exists, and its shape

- Question on the table: the operator compared Morgan with ChatGPT
  Advanced Voice Mode on the same underlying realtime model family and
  found AVM markedly more natural (fillers, pacing, turn feel). How do we
  close that gap without guess-and-check prompt fiddling?
- Positions and evidence: one-off tuning was rejected outright — the
  operator asked for an eval-driven loop ("Loop Engineering") where an
  operational bar, a fixed case set, and scorers decide what improved.
  The candidate levers were enumerated first (turn-taking policy,
  instructions' speech-style contract, voice and output settings, audio
  chain) so the loop tunes named levers, not vibes.
- Resolutions:
  - Runner is a hybrid: Evalite (vitest-based, lives in apps/web) is the
    loop cockpit; anything that must LISTEN to audio is precomputed by
    the Python scorer's DSP into JSON the scorers read. Rationale: the
    web stack is already vitest, and the DSP already measures the exact
    quantities the bar needs — it just measured the candidate until now.
  - This record: a public bar SSOT plus this worklog, in English, with
    big calls mirrored to DECISIONS. The defining-the-bar process is
    itself a portfolio artifact.
  - First cycle target: conversational naturalness, benchmarked against
    operator-recorded AVM conversations. The reference recordings stay
    local (voice data, DECISIONS 005 pattern); one is held out of tuning.
  - Budget: 5 to 10 fixed cases, one eval run per lever change, judge on
    gemini-2.5-flash at temperature 0. The suite is report-only and does
    NOT join the release gate until the bar survives several cycles
    unchanged.
  - Sequencing guard: turn-system levers stay blocked behind F-67's
    measure-first process; this loop's first lever is the instructions'
    speech-style section, and latency findings are filed to F-67 as
    evidence rather than tuned around.
- Follow-ups: Round 1 measures the AVM recordings and replaces every
  placeholder band in `bar.thresholds.json` with a measured one; Round 1
  also authors the judge rubric (bar.md section 4), which unblocks the
  judge scorer.
