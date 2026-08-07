# Morgan naturalness worklog

Newest first. Two entry kinds: **Round N** records a bar discussion
(question on the table, positions and evidence, resolution, follow-ups);
**Cycle cNN** records one loop cycle (one lever, one run, verdict). The
bar itself lives in `bar.md`; this file is how it got that way.

Discussions happen in Korean between the operator and the controller
session; entries here are the English distillation, written the day the
discussion happens.

---

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
