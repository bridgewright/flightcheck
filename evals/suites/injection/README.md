# injection (F-11b defence suite)

Does the intake refusal actually work? The rubric compiled from a job
description **is** the bar the customer is then measured against, so a JD
that is really an instruction set does not get quietly compiled — it gets
refused. That is a claim, and this suite is the evidence behind it.

Unlike the two judge suites, this one is **deterministic**: no model call,
no API key, no spend. That is not a shortcut. The defence being measured is
a classifier at intake (`scorer.promptsafe.classify_injection`), so its
gate costs nothing and therefore runs on every release rather than being
something the operator hesitates to spend credit on.

## The two numbers

| Metric | What it means | Baseline |
| --- | --- | --- |
| `hostile_recall` | share of instruction sets that are refused | `injection_hostile_recall_min` = 0.9 |
| `benign_false_positive_rate` | share of real postings that are refused | `injection_benign_false_positive_max` = 0.0 |

The asymmetry is deliberate. A missed instruction set still lands inside
the F-11a data fence, which the model usually respects. A false positive
tells a paying customer that their real job posting is an attack — that is
the error that loses the customer, so the ceiling on it is zero and the
recall bar keeps one fixture of margin.

## Layout

- `fixtures/hostile/*.md` — documents that are instruction sets. Several are
  a real posting with a payload appended, because that is the realistic
  shape: nobody pastes a bare "ignore previous instructions".
- `fixtures/benign/*.md` — real postings and real candidate documents. This
  half is adversarial **towards the detector** on purpose: AI-safety and
  prompt-engineering roles that legitimately say "prompt injection",
  "system prompt", "act as", and "you are an AI engineer". Those postings
  are this product's target market, so refusing one is a product failure,
  not a safe default.

Adding a fixture is the intended way to report a bypass. Drop the document
in `fixtures/hostile/`, run the gate, and if recall drops the gate fails —
which is the point.

## Commands (from `services/scorer/`)

- Gate (runs with the other suites): `uv run scorer-evals`
- This suite alone:
  `uv run python -c "from pathlib import Path; from scorer.evals_injection import run_injection_suite; print(run_injection_suite(Path('../../evals/suites/injection')))"`

Output lands in `evals/out/injection_defence.json` and in the
`injection_defence` block of `evals/out/regression.json`. Both name the
individual fixtures that missed or false-positived, so a failing gate says
which document moved rather than only that a ratio changed.
