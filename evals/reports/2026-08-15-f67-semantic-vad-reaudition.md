# F-67 semantic_vad re-audition — numbers or nothing (2026-08-15)

**Question (DECISIONS 075):** has the Realtime API's `semantic_vad` outgrown
the measurements that disqualified it on 2026-08-01 (DECISIONS 009), now that
the field trail shows `server_vad`'s silence-counting closing a real
candidate's thinking pause mid-answer?

**Verdict: REJECT, again — keep `server_vad` + `create_response: false`.**
Low eagerness reproduces its original disqualifier: it never committed two of
three tape-final complete segments. Medium eagerness interrupts the 8 s
thinking pause at 4.6 s — the exact failure the re-audition exists to rule
out — and triples the answer-end commit latency. Neither clears the bar
DECISIONS 075 set in advance.

## Method

Same apparatus as the 2026-08-01 bake-off (`evals/suites/vad_bakeoff/`),
clips regenerated per the suite README (macOS `say`, 24 kHz PCM16), streamed
at real-time pacing to the GA WS endpoint (`gpt-realtime`), every server
event recorded with timestamps plus send-side segment marks. New cells run
semantic_vad in the exact composition the product would use — the client
owns response timing, so `create_response: false`:

- `semantic_low_nocreate` — `{semantic_vad, eagerness: low, create_response: false}`
- `semantic_medium_nocreate` — same at `medium` (the docs now name `auto` as
  medium's alias, so medium replaces 2026-08-01's auto cell)
- `svad_nocreate` — the production config, re-run the same day as control

One run per cell over the three tapes (pause / complete / filler). All
timestamps below are aligned against the send-side marks, not wall guesses.

## Results

| Metric (bar set in DECISIONS 075) | semantic low | semantic medium | server_vad control |
| --- | --- | --- | --- |
| ① Commit after a complete answer (bar: comparable to today's ~1.5 s total quiet) | **NEVER** — no commit ≥12.1 s after the answer ended (complete tape), ≥11.1 s (filler tape's final segment) | +4.6 s | +0.99 s |
| ② The 8 s mid-answer thinking pause (bar: not interrupted) | held — sole commit fired +0.95 s after the post-pause continuation completed | **committed 4.6 s INTO the pause** | commits the lead at +0.99 s; no response fires (client decides) |
| ③ Event visibility while a turn is held (bar: the client clock must see) | 17.5 s with zero events (pause tape); indefinitely blind on complete/filler | blind inside each held stretch (6.3 s observed) | full speech_started/stopped per episode |
| ④ Uninvited responses under create_response:false (bar: zero) | 0 | 0 | 0 |

## Why this settles it, again

- **Low's never-commit is back, and it is still unpredictable.** The pause
  tape's terminal segment committed (+0.95 s — ideal); the complete and
  filler tapes' terminal segments never did, across ≥11 s of observed
  silence each. 2026-08-01 measured 2/2 never-commits; today it is 2/3. A
  turn policy that strands the interviewer on an unpredictable subset of
  finished answers is disqualified regardless of how good its pause handling
  is — in production that is Morgan going silent forever, the 2026-08-01
  verdict verbatim.
- **Medium fails the one scenario the re-audition was for.** 4.6 s into an
  8 s thinking pause it committed the turn. Under the product's client
  machinery the 0.6 s debounce would have Morgan answering ~5.2 s into the
  candidate's pause — later than server_vad's ~1.5 s, but the same defect
  class the F-67 trail recorded, at a price: answer-end latency triples
  (4.6 s vs 0.99 s control; the F-81 field report called even 2.1-2.4 s too
  slow) and filler stalls chunk into multi-second episodes that defeat the
  stall-blip filter's episode-length contract.
- **The starvation composition is structural, unchanged from 009.** With
  `create_response: false` and no commit, the client hears
  `speech_started` and then nothing. The silence clock reads "candidate
  still audible" indefinitely: no scaffold ladder, no debounce, no
  time-status nudges land in a turn-held room, and the session limps to the
  hard cut. Both semantic cells starve exactly the machinery the product
  runs on.
- Criterion ④ is the one clean pass: across all nine runs, zero
  `response.*` events — the `create_response: false` contract holds under
  semantic_vad too. It does not rescue ①-③.

## Consequence

`server_vad` (900 ms tail) + `create_response: false` stays. The field
defect that motivated this re-audition — the interviewer answering into a
resumed answer after a 1.6 s thinking pause, and a debounce deferred through
playback firing right after response-done — is real and remains open; per
DECISIONS 075 it now gets its own turn-policy pass on the client side
(where the timing already lives and unit tests can hold it), not a provider
turn-detection swap. The one real session DECISIONS 075 conditionally
budgeted is not spent: the lab pass did not earn it.

## Limitations (read before citing)

- One run per cell (the 2026-08-01 baseline had 1-2); synthesized prosody is
  not a hesitant non-native speaker; WS transport probed, production is
  WebRTC. The control cell matching its 2026-08-01 numbers to the tenth of a
  second is the calibration that makes the comparison honest.
- Low's commit behavior remains opaque: 1/3 terminal segments committed,
  and nothing in the event stream says why that one. The 009 revisit
  condition (event visibility during held turns + bounded commit latency)
  is still the right trigger for a third audition; neither shipped today.
