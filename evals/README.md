# evals/

The product's trust lives here. A release ships only when suites pass
(`uv run scorer-evals` from `services/scorer/`, exit 0, gated against
`baselines.json`).

## Layout

- `suites/` — runnable checks and their committed inputs:
  - `rubric_discrimination/` — evals layer 1: golden answer triplets against
    the committed eval rubric. **The evaluation criteria of record (the
    BARS-anchored rubric) live here**, at
    `suites/rubric_discrimination/rubric.json` — compiled by the product
    pipeline from a representative public JD.
  - `delivery_discrimination/` — evals layer 3: controlled delivery clip
    triplets (clips themselves gitignored, DECISIONS #005).
  - `bakeoff/` — W1 S2S provider bake-off: latency, stability, and
    scoring-channel audio discrimination. Run outputs committed under
    `bakeoff/out/`. Decision probe, not release-gated (DECISIONS #002).
  - `vad_bakeoff/` — F-06 turn-detection probe (`probe.py`): `semantic_vad`
    against `server_vad` + `create_response: false` over three scripted
    tapes, with eight full server-event logs committed under
    `vad_bakeoff/out/`. Decision probe, not release-gated (DECISIONS #009).
- `baselines.json` — committed accuracy floors the gate compares against.
- `reports/` — committed results: the two bake-offs
  (`2026-08-02-provider-bakeoff.md`, `2026-08-01-f06-vad-bakeoff.md`) and,
  per release, the gate numbers of record (`2026-07-26-v01-gate.md`,
  `2026-08-01-v02-gate.md`, `2026-08-03-v05-gate.md`).
- `out/` — generated run artifacts, **gitignored by convention**: local runs
  write here, and the numbers of record are committed verbatim into a
  `reports/` snapshot instead. If a public number ever disagrees with a
  fresh `out/` run, the gate — not the doc — decides.

## What the gate covers, and what it does not

The gate is two suites. Naming its edges is part of the contract: this repo
claims that evals gate releases, so a reader should be able to see exactly
how much that buys.

**Gated today** — the whole of `uv run scorer-evals`:

| Suite | What it decides | N at v0.5 | Floor |
| --- | --- | --- | --- |
| `rubric_discrimination` (layer 1) | the content judge orders strong > borderline > weak, strictly | 3 triplets | 0.8 |
| `delivery_discrimination` (layer 3) | the delivery judge scores fluent strictly above both filler and hesitant | 2 clip triplets | 0.8 |

Those are the whole samples, not a subset drawn from something larger: one
boundary case decides either suite. Nothing here is a precision estimate.
Layer 3 also reports DSP separability (`dsp_pass`), which has no committed
baseline and does not gate — it is recorded for visibility only.

**Not gated.** These are covered by unit and integration tests instead, which
is a weaker guarantee than an eval and is stated rather than implied:

- **Prompt-injection resistance.** The v0.5 delimiter fencing and
  hidden-text strip are unit-tested at
  `services/scorer/tests/test_promptsafe.py`. Layer 1 exercises the fences
  incidentally (it runs the judge prompt) but nothing adversarial is
  attempted. The adversarial eval suite that would gate this is F-11b, v0.6.
- **The scoring-eligibility gate** (F-04) — `tests/test_eligibility.py`.
- **Report field quality** — `tests/test_report_compile.py` and
  `apps/web/tests/report-format.test.ts` pin verdict thresholds, copy, and
  the language lint. No eval judges whether a report is *useful*.
- **Package and payment lifecycle** — `tests/test_api_trial_quota.py`,
  `tests/test_api_payments.py`,
  `apps/web/tests/webhooks-polar-route.test.ts`.

The gated surface has not grown since v0.1: same two suites, same N, same
floors (`baselines.json` has one commit in its history, `9d7520e`), while the
product added payments, an eligibility gate, injection fencing, and new report
fields. That is a real gap, and closing it is v0.6 work rather than something
this release claims.

**No instrument yet.** Judge–human scoring agreement (Cohen's κ ≥ 0.8 by
v1.0) is a PRD success metric with nothing that computes it. The blind-rank
sheets it would consume are committed and filled
(`suites/rubric_discrimination/manual/`); the comparison against judge
output is currently made by eye, and no κ has been reported.

## Reading a gate result from a clean clone

A suite whose inputs are absent is reported **SKIPPED** and the gate still
exits 0 (`services/scorer/src/scorer/evals_l3/regression.py`) — visible in
the JSON, never a silent pass. What that means for an outside reviewer: the
layer-3 clips are gitignored by decision (DECISIONS #005), so a fresh clone
reproduces layer 1 only, and a run pointed at a tree with no inputs at all
exits 0 having judged nothing. Read the per-suite `status`, not the exit
code alone. (A missing API key is not one of these cases — it exits
non-zero with a message.)
