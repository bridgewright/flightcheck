# Morgan naturalness bar (SSOT)

> Status: v0 strawman, every axis `proposed` | report-only, NOT a release
> gate | last revised 2026-08-07

This document is the operational definition of "Morgan sounds like a
conversation, not a form being filled in". Every axis below must survive
the test this file exists to enforce: if two people can disagree about
whether a session passed an axis, the axis is not yet written down.

The discussion that produces each revision is in `worklog.md`, newest
first. Numeric bands live twice: prose here, machine-readable in
`bar.thresholds.json` (the eval scorers read the JSON; this file says why
the numbers are what they are).

## 1. What "natural" means here, and what it does not

In scope: the conversational surface of the interviewer — when Morgan
starts speaking, for how long, with how many questions at once, with what
vocal variation, and whether the exchange feels like turn-taking between
two people.

NOT in scope: accent quality (delivery scoring owns it), the content of
the questions (the rubric and planner own it), and turn-system latency
mechanics (the VAD tail and the client response policy are BLOCKED behind
F-67 — see section 5).

## 2. Reference standard

The reference is ChatGPT Advanced Voice Mode, recorded by the operator in
scripted conversations. Protocol (to be pinned in Round 1): 2 or 3
recordings, several minutes each, at least one following the same opening
an interview session has (greeting, first question, a short answer, a
follow-up). One recording is HELD OUT of all tuning discussions and
checked only when the bar itself is revised.

Recordings are voice data and are never committed (see
`reference/README.md`); this section is their committed description, and
the measured numbers that justify each band are quoted in the worklog.

## 3. Axes

Every axis carries: definition (observable behavior only), metric (the
exact JSON field from `scorer-morgan-metrics`), how measured, target BAND
(bands, not points — transcript timestamps carry roughly half a second of
jitter), why this target, status, open questions.

### Axis: response onset
- Definition: how long after the candidate stops speaking Morgan begins.
- Metric: `metrics.response_latency_s.p90` (mean recorded alongside).
- How measured: DSP, candidate-end to interviewer-start over direct
  transitions; negative gaps are interruptions and counted elsewhere.
- Target: PLACEHOLDER band pending AVM measurement.
- Why: unmeasured; Round 1 sets it from the AVM recordings.
- Status: proposed.
- Open questions: today the 1.2 s client debounce puts a floor under this
  number, so until F-67 closes this axis is MEASUREMENT ONLY — it can
  produce evidence for F-67, never a prompt-side tuning target.

### Axis: share of air
- Definition: how much of the conversation is Morgan talking.
- Metric: `metrics.talk_time_ratio`.
- How measured: DSP, interviewer speaking seconds over all speaking
  seconds.
- Target: PLACEHOLDER band pending AVM measurement and Round 1; an
  interviewer should hold well under half the air.
- Status: proposed.

### Axis: turn length
- Definition: Morgan speaks in conversational turns, not monologues.
- Metric: `metrics.turn_length_p50_s`, with `turn_length_max_s` as the
  monologue tripwire.
- How measured: DSP; a turn is a maximal run of interviewer segments with
  no candidate segment between them.
- Target: PLACEHOLDER band.
- Status: proposed.

### Axis: one question at a time
- Definition: a turn asks at most one question; stacked questions read as
  an interrogation script, not a conversation.
- Metric: `metrics.questions_per_turn_mean` and
  `metrics.multi_question_turn_count`.
- How measured: question marks in the transcript of each turn.
- Target: PLACEHOLDER; the direction is certain (fewer stacked questions),
  the band is not.
- Status: proposed.

### Axis: verbal texture
- Definition: Morgan uses the small words a person uses — brief
  acknowledgements and natural connectives — instead of laboratory-clean
  sentences.
- Metric: `metrics.morgan_filler_rate_per_min`.
- How measured: DSP filler lexicon over Morgan-side transcript (speaker
  labels inverted for this reuse).
- Target: PLACEHOLDER. NOTE the direction is unusual: higher is MORE
  natural up to a band; zero reads robotic. The band's ceiling exists
  because a filler-heavy interviewer reads unprepared.
- Status: proposed.
- Open questions: the filler lexicon was tuned for candidates; Round 1
  decides whether backchannels ("mm-hm", "right") need their own lexicon
  entry or their own metric.

### Axis: vocal variation
- Definition: Morgan's pitch moves the way an engaged speaker's does.
- Metric: `metrics.morgan_f0_variance`.
- How measured: DSP pyin over Morgan-side spans.
- Target: PLACEHOLDER band from AVM measurement.
- Status: proposed.
- Open questions: unvoiced or too-short audio yields no f0 number at all;
  the metrics JSON carries an honest null and the report says
  "unmeasured", but in v0 an unmeasured axis still scores 0 like an
  out-of-band value. Round 1 decides whether unmeasured should instead be
  excluded from the case's score.

### Axis: keeps out of the candidate's way
- Definition: Morgan does not start talking while the candidate still is.
- Metric: `metrics.morgan_interruption_count` (overlap of at least 0.3 s;
  smaller overlaps are timestamp jitter).
- How measured: DSP, interviewer segment starting strictly inside a
  candidate segment's span.
- Target: PLACEHOLDER, expected near zero — `interrupt_response: false`
  makes true barge-in rare by construction, so a nonzero number probably
  indicates echo artifacts and is diagnostic either way.
- Status: proposed.

### Axis: conversational flow (judge)
- Definition: a listener reading the exchange rates it as a conversation
  between two people rather than a scripted Q and A.
- Metric: judge score, 1 to 5, normalized.
- How measured: LLM judge (gemini-2.5-flash, temperature 0) over the
  speaker-tagged transcript, using the rubric in section 4 verbatim.
- Target: PLACEHOLDER.
- Status: proposed — BLOCKED on Round 1 writing section 4.

## 4. Judge rubric (verbatim)

NOT YET WRITTEN. Round 1 authors the anchored 1-to-5 rubric here; the
judge scorer sends this section's fenced block verbatim and nothing else.
Until then the judge scorer does not run.

## 5. Out of scope this loop

Turn-system levers are BLOCKED pending F-67 (DECISIONS 046): the VAD
parameters in `apps/web/lib/realtime.ts` and the client response policy in
`apps/web/lib/session-room.ts`. This loop may produce EVIDENCE that
implicates them (a latency floor no prompt lever can move); that evidence
is filed to F-67 through the worklog, and the axis is annotated — the
loop never tunes around a blocked lever.

## 6. Bar revision log

- 2026-08-07 — v0 strawman created; every axis proposed, every band a
  placeholder pending the AVM reference measurements (worklog Round 0).
