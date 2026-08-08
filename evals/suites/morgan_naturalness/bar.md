# Morgan naturalness bar (SSOT)

> Status: v1 — experience definition agreed and axes reorganized into
> four families (2026-08-08); every numeric band still PLACEHOLDER
> pending the AVM reference measurements | report-only, NOT a release
> gate | last revised 2026-08-08

This document is the operational definition of "Morgan sounds like a
person, not a form being filled in". Every axis below must survive the
test this file exists to enforce: if two people can disagree about
whether a session passed an axis, the axis is not yet written down.

The discussion that produces each revision is in `worklog.md`, newest
first. Numeric bands live twice: prose here, machine-readable in
`bar.thresholds.json` (the eval scorers read the JSON; this file says
why the numbers are what they are).

## 1. What this bar serves

The product's north star (operator-authored, 2026-08-08): for someone
preparing English interviews in a language that is not their own, the
product REMOVES THE UNCERTAINTY — using it produces the belief "if I
prepare with this, I will be prepared." Every feature carries a piece
of that: the dashboard answers "where am I and what do I fix next", the
coaching and study surfaces answer "this is exactly what to study."

The voice agent's piece is the conviction that the practice was real:
**"that felt like interviewing with a real interviewer — preparing
against this is preparing for the real thing."** That goal decomposes
into two different problems:

1. **Sounds like a real person** — timing, texture, and structure of
   the conversation itself. THIS SUITE owns exactly this.
2. **Acts like a real interviewer** — company-aware commentary,
   engaging the candidate's actual content, adaptive warmth and pacing.
   Instruction-driven, tracked as its own feature, and deliberately OUT
   of this suite: it changes what Morgan says, not whether Morgan
   sounds human, and several of its levers (warmth) intentionally move
   this suite's numbers — so it ships only after these bands stabilize,
   as a recorded lever.

Also not in scope: accent quality (delivery scoring owns it), the
content of the questions (the rubric and planner own it), and
turn-system latency mechanics (VAD tail and client response policy are
BLOCKED behind F-67 — see section 6).

## 2. Reference standard

The reference is ChatGPT Advanced Voice Mode, recorded by the operator
in scripted conversations — the protocol, the paste-ready AVM role
prompts, and the candidate-proxy rules for cycle recordings are pinned
in `reference-protocol.md`. Three recordings, 5–10 minutes each; one
(avm-r3) is HELD OUT of all tuning discussions and opened only when
the bar itself is revised.

A band is never the raw AVM number. It is the AVM measurement ±
measurement tolerance ± PRODUCT JUDGMENT — AVM is a chat partner and
Morgan is an interviewer, so some axes deviate from AVM on purpose (an
interviewer holds less air, restrains fillers, asks strictly one
question). Every deliberate deviation is recorded in the worklog with
its reason.

Recordings are voice data and are never committed (see
`reference/README.md`); the measured numbers that justify each band are
quoted in the worklog.

## 3. Axes — four families

| family | axis | metric | status |
| --- | --- | --- | --- |
| 1 Rhythm | 1.1 response onset | `response_latency_s.p90` | measurement-only (F-67) |
| 1 Rhythm | 1.2 keeps out of the way | `morgan_interruption_count` | proposed |
| 1 Rhythm | 1.3 turn length | `turn_length_p50_s` (+`max` tripwire) | proposed |
| 1 Rhythm | 1.4 share of air | `talk_time_ratio` | proposed |
| 2 Texture | 2.1 verbal texture | `morgan_filler_rate_per_min` | proposed |
| 2 Texture | 2.2 vocal variation | `morgan_f0_variance` | proposed |
| 2 Texture | 2.3 speech rate | `morgan_wpm_overall` | proposed (added v1) |
| 3 Structure | 3.1 one question at a time | `questions_per_turn_mean`, `multi_question_turn_count` | proposed |
| 3 Structure | 3.2 built on my answer | judge criterion (section 4) | folded into judge |
| 3 Structure | 3.3 acknowledges, then asks | judge criterion (section 4) | folded into judge |
| 4 Holistic | 4.1 conversational flow | judge score 1–5 | blocked on section 4 |

3.2 and 3.3 are real qualities with no honest number: any lexical
proxy (word overlap with the previous answer) rewards parroting and
gets gamed. They are scored by the judge, as named rubric criteria,
rather than pretending to be metrics.

### Family 1 — rhythm (when Morgan speaks, and when it does not)

- **1.1 response onset.** How long after the candidate stops speaking
  Morgan begins; p90 over direct transitions (naturalness dies at the
  worst gaps, not the average — mean recorded alongside). Negative
  gaps are interruptions and counted in 1.2. MEASUREMENT ONLY until
  F-67 closes: the 1.2 s client debounce puts a floor under this
  number no prompt lever can move, so until then this axis produces
  EVIDENCE for F-67, never a tuning target. Eventual band is
  two-sided: instant replies read as machine eagerness, long gaps read
  as dead air; both edges from the AVM measurement.
- **1.2 keeps out of the way.** Interviewer segment starting strictly
  inside a candidate segment's span, overlap ≥ 0.3 s (smaller is
  timestamp jitter). Expected near zero by construction
  (`interrupt_response: false`); nonzero is likely echo artifacts and
  diagnostic either way.
- **1.3 turn length.** Conversational turns, not monologues; p50 with
  max as the monologue tripwire. A turn is a maximal run of
  interviewer segments with no candidate segment between them.
- **1.4 share of air.** Interviewer speaking seconds over all speaking
  seconds. An interviewer should hold well under half the air — this
  is one of the axes where the band deliberately sits BELOW the AVM
  chat-partner number.

### Family 2 — texture (what the voice sounds like)

- **2.1 verbal texture.** Fillers and natural connectives per minute
  on Morgan's side (candidate lexicon reused with labels inverted).
  Direction is unusual: higher is MORE natural up to a band; zero
  reads robotic; the ceiling exists because a filler-heavy interviewer
  reads unprepared. Open question: whether backchannels ("mm-hm",
  "right") need their own lexicon entry or their own metric.
- **2.2 vocal variation.** Pitch (f0) variance over Morgan's spans, via
  pyin. Unvoiced or too-short audio yields an honest null — reported
  as "unmeasured", and whether unmeasured should score 0 or be
  excluded from the case is still an open Round 1 decision.
- **2.3 speech rate (added v1).** Morgan's words per minute. Humans
  converse in a fairly narrow band; too fast reads as script
  narration, too slow reads as condescension or lag. The metric was
  already computed and stamped into every metrics document — v1
  promotes it to an axis at zero measurement cost.

### Family 3 — structure (whether it converses like a dialogue)

- **3.1 one question at a time.** Question marks per interviewer turn;
  stacked questions read as an interrogation script. Mean plus a
  count of turns carrying 2+ questions. Direction certain, band not.
- **3.2 built on my answer** (judge criterion). The next question
  stands on what the candidate just said, not on a list being worked
  through.
- **3.3 acknowledges, then asks** (judge criterion). A brief reaction
  to the answer before the next question — the active-listening
  surface the instructions already contract for.

### Family 4 — holistic (what numbers cannot hold)

- **4.1 conversational flow.** An LLM judge (gemini-2.5-flash,
  temperature 0) reads the speaker-tagged transcript and scores 1–5
  against the rubric in section 4 verbatim. BLOCKED until section 4 is
  authored (Round 1). The rubric must name 3.2, 3.3, and respect for
  the candidate's silences as criteria, and must NOT penalize warmth —
  warmth is a future instruction-side lever, not a naturalness defect.

## 4. Judge rubric (verbatim)

NOT YET WRITTEN. Round 1 authors the anchored 1-to-5 rubric here; the
judge scorer sends this section's fenced block verbatim and nothing
else. Until then the judge scorer does not run. Required criteria when
authored: follow-ups built on the candidate's answers (3.2),
acknowledgment before the next question (3.3), respect for the
candidate's pauses, and no penalty for warmth.

## 5. Operating principles

The loop runs on eval-driven development discipline; these are the
house rules this suite already practices, named so they survive us:

- **Dimensional, never aggregate.** There is no single "naturalness
  score" anywhere — not in the thresholds, not in the reports. A
  collapsed number says something moved without saying what; the axis
  table IS the readout. (The failure this forbids is the
  one-big-score dashboard whose drop starts an archaeology dig.)
- **Deterministic first, judge last.** Ten of eleven axes are
  deterministic measurements from audio and transcript; the judge is
  the last net for what numbers cannot hold, on the cheapest capable
  model, at temperature 0, against a pinned verbatim rubric.
- **An instrument panel, not a gate.** The suite is report-only until
  the bar survives cycles unchanged (DECISIONS 047). Gating a release
  on unvalidated bands is fake quality.
- **Determinism over averaging.** Where EDD practice reruns
  non-deterministic evals and averages, this suite pins instead:
  temperature 0, content-hash-frozen transcripts per case, and a
  measurement-provenance stamp in every metrics document, so a moved
  number implicates the system or the ruler — never the dice.
- **A field failure becomes a case.** When a real session sounds wrong
  in a way the axes missed, its clip joins the frozen baseline set and
  the miss becomes a bar revision — the production-failure-to-
  regression-case rule, applied to conversation feel.
- **The evaluators are themselves evaluated.** Frozen baselines are
  re-scored every cycle as a judge-drift canary; the judge earns trust
  through operator agreement before its score means anything; the
  provenance stamp says which ruler measured what.
- **One lever, one run, one entry.** Causality stays readable or the
  loop is fiddling with extra steps.

## 6. Out of scope this loop

Turn-system levers are BLOCKED pending F-67 (DECISIONS 046): the VAD
parameters in `apps/web/lib/realtime.ts` and the client response policy
in `apps/web/lib/session-room.ts`. This loop may produce EVIDENCE that
implicates them (a latency floor no prompt lever can move); that
evidence is filed to F-67 through the worklog, and the axis is
annotated — the loop never tunes around a blocked lever.

Interviewer-behavior realism (company-aware commentary, adaptive
warmth and pacing) is instruction-side work tracked outside this
suite; it arrives, later, as recorded levers — never as silent drift.

## 7. Bar revision log

- 2026-08-08 — v1: experience definition agreed (uncertainty north
  star; real-person vs real-interviewer split); axes reorganized into
  four families; speech rate promoted to axis 2.3 (metric already
  measured); 3.2/3.3 named as judge criteria; operating principles
  written down (worklog Round 1).
- 2026-08-07 — v0 strawman created; every axis proposed, every band a
  placeholder pending the AVM reference measurements (worklog Round 0).
