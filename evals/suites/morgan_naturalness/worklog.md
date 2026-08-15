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

## 2026-08-08 — response policy moved before Round 1 baselines

- Two turn-feel levers changed from field feedback, BEFORE any baseline
  was frozen, so nothing is poisoned: the client response debounce
  dropped 1.2 s → 0.6 s (DECISIONS 055 — the acoustic 900 ms VAD tail
  is untouched; it remains an F-67-blocked lever), and the interviewer
  now ends the session after its own closing line, with the closing
  instruction hardened to an exact final sentence (DECISIONS 056).
- Consequence for this suite: the `response_latency_p90_s` placeholder
  band ([0.5, 2.5]) was written against a floor ~0.6 s higher than
  today's; Round 1 measures against the NEW policy and the band gets
  set from those measurements.
- Bookkeeping rule going forward: `lever_state` for every case run
  records the session-room response-policy commit alongside the
  instructions commit — the debounce is part of turn feel, and a run
  that ignores it is comparing across policies.

## 2026-08-12 — instructions lever moved: interviewer-behavior realism (B7-T1)

- The instructions lever moves with this track's landing commit
  (track/b7-t1-interviewer-realism, F-75, DECISIONS 064) — the first
  deliberate move since the suite was built. The standard 20-minute
  instructions gain company-aware commentary grounded in the rubric's
  own facts, substance-engaged transitions, spare-time spending, an
  adaptive wrap-up register, and conservatively-triggered warmth past
  the midpoint. The quick-interview instructions did not move — now
  pinned byte-for-byte. Timing is untouched: adaptivity changes WHAT is
  said, never WHEN the session ends.
- Round 1 has not run (cases list empty, AVM references pending), so no
  baseline is poisoned by this move. The first Morgan baseline will be
  recorded against the post-064 instructions, with `lever_state`
  stamping the instructions commit as the manifest contract requires;
  the next gate report records the instructions hash as MOVED, by this.
- For the judge rubric, when Round 1 authors it (bar.md section 4): it
  must not penalize warmth. A short laugh or one light aside past the
  midpoint of a clearly strong session is DECISIONS 064's intended
  behavior, not a naturalness defect — the conservative trigger is the
  feature.

## 2026-08-15 — VAD lever moved: playback-aware input gating (B11-T1)

- The acoustic layer gains a dynamic component with this track's
  landing commit (F-67 Phase 1, DECISIONS 074): while the interviewer
  is audible plus a 2.0 s hangover, the client raises the server VAD
  threshold 0.6 -> 0.85 via session.update and restores it at expiry.
  New recorded levers: `GATED_VAD_THRESHOLD` (0.85) and
  `PLAYBACK_GATE_HANGOVER_S` (2.0), both in apps/web. The resting
  threshold (0.6), the 900 ms tail, and the 0.6 s response debounce
  did not move.
- Round 1 has still not run (AVM references pending), so no baseline
  is poisoned. Any Morgan case recorded from here on runs under the
  gated policy during and just after interviewer audio; `lever_state`
  for such cases must stamp the session-room commit (the manifest's
  vad object records the RESTING values — note the gate separately in
  the case's free-text note until the manifest schema grows a field).
- Turn-feel caveat for future measurements: a candidate whose answer
  onset lands inside the 2.0 s hangover speaks against the 0.85 bar;
  if onsets read as clipped in Round 1 audio, check the trail for
  onsets swallowed by the gate (cand-start only after vad-restore)
  before blaming the model's pacing.

## 2026-08-15 — instructions lever moved: opening turn stops (B12-T1)

- The instructions lever moves again with F-67's residual fix
  (DECISIONS 077): the opening's two checks become structural turn
  stops in BOTH renders — the standard 20-minute and, for the first
  time since its B7 pin, the quick. The first gated live session
  produced the whole opening as one 24.5 s response with both checks
  self-answered; the fix makes each check end the interviewer's
  turn, bans self-answering by principle (review-generalized beyond
  the two observed tokens), and forbids railroading past a "cannot
  hear you".
- The hash moved twice inside the track (implementation, then review
  round 1's ban generalization + trouble clauses). Final pinned
  values: standard `858d9635...`, quick named `fea08f1d...`, quick
  bare `f7299183...` (test_sessionplan_planner.py holds the full
  digests). Delta confined to # OPENING in all three renders,
  verified by document diff in both review rounds.
- Round 1 has still not run (AVM references pending), so no baseline
  is poisoned. Opening-turn pacing in future Morgan cases reflects
  the multi-turn opening; reference AVM cases have no opening
  contract, so no comparability loss.
- Known incoherence, registered open: the silence ladder's staged
  texts assume a mid-question stall and read wrong at a greeting
  (30 s rung offers to skip the audio check). Web-side fix pending;
  do not count a ladder firing inside the opening as an interviewer
  naturalness defect in judging.

## 2026-08-15 — response-policy and instructions levers moved: B13 turn feel

- DECISIONS 080-082, same-day field session. Response-policy levers:
  `RESPONSE_DEBOUNCE_S` 0.6 -> 0.45 behind a new cancel window (an
  armed response is revocable until the interviewer's first audio);
  `TURN_NUDGE_S` 3.0 (new); barge-in truncation behind
  `BARGE_SUSTAIN_MS` 750 / `BARGE_LEVEL_MULTIPLE` 3 / corr veto. All
  six values are pinned by name in the web suite.
- Instructions lever moved again, in both renders, three times inside
  the batch (implementation, round 1's exception carve-out, round 2's
  fifth exception): opening is exactly two turns; every turn ends
  facing the candidate, exceptions named not counted. The byte pins
  in test_sessionplan_planner.py are the authoritative digests; this
  note is a pointer, not a copy.
- Turn-feel note for Round 1 judging: interviewer turns can now be
  CUT mid-audio by a validated barge-in, canceled before first
  audio, and nudged to continue after statement turns. None of these
  are naturalness defects; read the trail (barge-cut, response-cancel,
  turn-nudge) before attributing pacing artifacts to the model.
