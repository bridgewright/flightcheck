# evals/

The product's trust lives here. A release ships only when the suites pass —
`cd services/scorer && uv run scorer-evals`, exit 0, gated against
`baselines.json`. The console script is declared in that project's
`pyproject.toml` and resolves only from that directory; run from the repo
root it does not exist.

## Layout

- `suites/` — runnable checks and their committed inputs:
  - `rubric_discrimination/` — evals layer 1: golden answer triplets against
    the committed eval rubric. **The evaluation criteria of record (the
    BARS-anchored rubric) live here**, at
    `suites/rubric_discrimination/rubric.json` — compiled by the product
    pipeline from a representative public JD.
  - `delivery_discrimination/` — evals layer 3: controlled delivery clip
    triplets (clips themselves gitignored, DECISIONS #005).
  - `injection/` — F-11b injection defence: 13 hostile and 16 benign
    fixtures, all committed as plain markdown. Deterministic — it calls a
    classifier, not a model, so it needs no API key and costs nothing
    (DECISIONS #027).
  - `rubric_faithfulness/` — F-62 licensing suite: three committed JD
    fixtures (`jd.md`, a stubbed-research `findings.json`, and
    `expectations.json` each), compiled live and checked deterministically —
    every content dimension must quote the JD verbatim, and a salted
    research finding must not become a dimension the JD never asked for.
  - `bakeoff/` — W1 S2S provider bake-off: latency, stability, and
    scoring-channel audio discrimination. Run outputs committed under
    `bakeoff/out/`. Decision probe, not release-gated (DECISIONS #002).
  - `vad_bakeoff/` — F-06 turn-detection probe (`probe.py`): `semantic_vad`
    against `server_vad` + `create_response: false` over three scripted
    tapes, with eight full server-event logs committed under
    `vad_bakeoff/out/`. Decision probe, not release-gated (DECISIONS #009).
- `baselines.json` — committed accuracy floors the gate compares against.
- `reports/` — committed results: the two decision bake-offs
  (`2026-08-02-provider-bakeoff.md`, `2026-08-01-f06-vad-bakeoff.md`) and,
  per release, the gate numbers of record, dated and named for their tag.
  `ls reports/` is the list; this line does not repeat it, because a
  hand-maintained copy of a directory listing is a thing that goes stale
  between releases and this repo has the scars to prove it.
- `out/` — generated run artifacts, **gitignored by convention**: local runs
  write here, and the numbers of record are committed verbatim into a
  `reports/` snapshot instead. If a public number ever disagrees with a
  fresh `out/` run, the gate — not the doc — decides.

## What the gate covers, and what it does not

The gate is four suites. Naming its edges is part of the contract: this
repo claims that evals gate releases, so a reader should be able to see
exactly how much that buys.

**Gated today** — the whole of `uv run scorer-evals`:

| Suite | What it decides | N at this tag | Floor |
| --- | --- | --- | --- |
| `rubric_discrimination` (layer 1) | the content judge orders strong > borderline > weak, strictly | 3 triplets | 0.8 |
| `delivery_discrimination` (layer 3) | the delivery judge scores fluent strictly above both filler and hesitant | 2 clip triplets | 0.8 |
| `injection_defence` (F-11b) | a job description that is really an instruction set is refused at intake, and a real posting is not | 13 hostile · 16 benign | recall ≥ 0.9 · false positives ≤ 0.0 |
| `rubric_faithfulness` (F-62) | every content dimension of a compiled rubric is licensed by a verbatim JD quote, and salted research findings cannot smuggle in an off-JD dimension | 3 JD fixtures | 1.0 |

The two judge samples are the whole samples, not a subset drawn from
something larger: one boundary case decides either suite. Nothing there is a
precision estimate. Layer 3 also reports DSP separability (`dsp_pass`),
which has no committed baseline and does not gate — it is recorded for
visibility only.

The injection suite gates in both directions and the ceiling is the strict
one: a missed instruction set is still fenced, while a refused real posting
is a paying customer told their job description is an attack, so the
tolerance for that is **zero** rather than small. Its benign half is
adversarial towards the detector on purpose — AI-safety and
prompt-engineering postings that legitimately say "system prompt" and
"ignore instructions" are this product's target market, and six of the
sixteen are phrasings the first classifier actually refused.

**Not gated.** These are covered by unit and integration tests instead, which
is a weaker guarantee than an eval and is stated rather than implied:

- **The scoring-eligibility gate** (F-04) — `tests/test_eligibility.py`.
- **Report field quality** — `tests/test_report_compile.py` and
  `apps/web/tests/report-format.test.ts` pin verdict thresholds, copy, and
  the language lint. No eval judges whether a report is *useful*.
- **Package and payment lifecycle** — `tests/test_api_trial_quota.py`,
  `tests/test_api_payments.py`,
  `apps/web/tests/webhooks-polar-route.test.ts`.

The gated surface has grown twice, and the shape of the remaining gap is
worth stating plainly. From v0.1 through v0.5 it did not move at all: the
same two judge suites, the same N, the same two floors, while the product
added payments, an eligibility gate, injection fencing and new report
fields. v0.6 closed one of those — `injection_defence` joined the gate with
two floors of its own. The rest of the list above is still unit-tested
rather than evaluated, and the reason the injection suite was the one to
move first is not that it was the most important: it is deterministic, so it
costs nothing to run, while every additional judge suite costs model credit
on every release. That is an honest constraint, not a principle.

The second growth is `rubric_faithfulness` (F-62), which is why
`baselines.json` now carries five numbers, and it breaks the free-to-run
pattern: it compiles its three committed JDs live, which makes it the
slowest suite in the gate — three compiles at roughly 100–200 seconds each,
plus the compiler's internal repair retries when the model needs them.
Committing each fixture's `findings.json` (a stubbed research sweep) is what
holds a fixture at 1–2 model calls — the compile and at most one repair —
instead of the ~7 a live sweep would add. Its floor is 1.0 on purpose: with
three fixtures there is no room for one of them to grow an unlicensed
dimension.

**No instrument yet.** Judge–human scoring agreement (Cohen's κ ≥ 0.8 by
v1.0) is a PRD success metric with nothing that computes it. The blind-rank
sheets it would consume are committed and filled
(`suites/rubric_discrimination/manual/`); the comparison against judge
output is currently made by eye, and no κ has been reported.

## Reading a gate result from a clean clone

A suite whose inputs are absent is reported **SKIPPED** and the gate still
exits 0 (`services/scorer/src/scorer/evals_l3/regression.py`) — visible in
the JSON, never a silent pass. What that means for an outside reviewer, per
suite:

- `injection_defence` reproduces **in full, from a clean clone, with no API
  key and no spend.** All 29 fixtures are committed and the classifier is
  deterministic, so this is the one suite here an outside reviewer can run
  end to end for themselves, in about a minute:
  ```
  cd services/scorer && uv run python -c "from pathlib import Path; from scorer.evals_injection import run_injection_suite; print(run_injection_suite(Path('../../evals/suites/injection')))"
  ```
  At this tag that prints `hostile_recall: 1.0` (13 of 13 refused) and
  `benign_false_positive_rate: 0.0` (0 of 16 refused), with empty `misses`
  and `false_positives` lists. Both figures clear their floors; only the
  floors gate, so a future run may differ and still pass.
- `rubric_discrimination` reproduces from a clean clone with a
  `GEMINI_API_KEY` — its three triplets and the rubric are committed.
- `rubric_faithfulness` reproduces from a clean clone with a
  `GEMINI_API_KEY`, like `rubric_discrimination`: all three fixtures are
  committed and only the compiles themselves need the model. Expect it to be
  the slow part of the run, and expect the dimension wording — though not
  the pass verdict, if the compiler is healthy — to vary between runs.
- `delivery_discrimination` does **not**: the clips are voice recordings and
  are gitignored by decision (DECISIONS #005), so it reports SKIPPED
  everywhere but the operator's machine.

A run pointed at a tree with no inputs at all therefore exits 0 having
judged nothing. Read the per-suite `status`, not the exit code alone. (A
missing API key is not one of these cases — it exits non-zero with a
message.)
