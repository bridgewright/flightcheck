# rubric_faithfulness (F-62 licensing suite)

Does a compiled rubric stay licensed by the job description? The rubric
**is** the bar the customer is then measured against, and the compiler
reads more than the JD: research findings, corpus excerpts, few-shot
examples. On 2026-08-04 that went wrong in production — a rubric whose
top-weighted content dimension was mission alignment, licensed entirely by
responsible-AI research citations, against a JD whose only ethics content
was About-section boilerplate. The customer would have been interviewed
and scored against a bar their job description never asked for. This suite
is the evidence that the fix holds.

Unlike the injection suite this one is **not** free: every fixture costs
one live `compile_rubric` call (`GEMINI_API_KEY`), which makes it the
slowest suite in the gate — roughly 100–200 seconds per fixture, plus the
compiler's internal repair retry when the model needs it. The runner adds
no retries of its own. Each fixture's `findings.json` is committed — a
stubbed research sweep — which holds a fixture at 1–2 model calls instead
of the ~7 a live sweep would add. Every **check** on the compile output,
however, is deterministic.

## The metric

| Metric | What it means | Baseline |
| --- | --- | --- |
| `pass_rate` | share of fixtures whose compiled rubric passes every check | `rubric_faithfulness_min` = 1.0 |

The floor is 1.0 on purpose: with three fixtures there is no room for one
of them to grow an unlicensed dimension. Two kinds of check feed it:

- **machinery** — every content dimension carries a non-empty
  `jd_evidence` that is an exact substring of the same processed JD the
  compiler compared against. The match is strict `in`, no whitespace
  salvage — deliberately stricter than the compiler, so a compiler
  regression that stores a normalized string instead of a haystack slice
  is caught here. Delivery dimensions are exempt: they are licensed by the
  product, not the JD.
- **behavior** — per-fixture `expectations.json`: no dimension in either
  channel matches a forbidden topic regex, every required topic matches at
  least one dimension, and the delivery-channel count stays in its band.

A compile refusal is a named fixture failure, never a crash: the
pathological JD is a paying user's JD, and the product must compile it
without the unlicensed dimensions, not refuse it.

## Layout

- `fixtures/<name>/jd.md` — the job description, verbatim.
- `fixtures/<name>/findings.json` — a committed `ResearchFindings`
  document, standing in for the live research sweep.
- `fixtures/<name>/expectations.json` — `forbidden_topics` and
  `required_topics` (regex lists), `delivery_dims_min`,
  `delivery_dims_max`, and prose `notes`.

Three fixtures:

- `values-boilerplate-fdpm` — the pathological one, modeled on the
  production failure: an FDPM JD whose only ethics content is
  About-section boilerplate, with findings deliberately salted with
  responsible-AI interview articles. A faithful compile gives this rubric
  no ethics, values, or mission dimension in either channel.
- `ai-safety-genuine` — the mirror image: a JD whose responsibilities
  **are** safety work, so a safety or evaluations dimension is required at
  honest weight. This fixture is what proves the contract is a licensing
  rule, not a topic ban.
- `plain-control` — no AI-adjacent salt at all: an ordinary analytics role
  whose About section mentions community and sustainability, none of which
  may surface as a dimension.

Adding a fixture is the intended way to report an unfaithful compile: drop
the JD, findings, and expectations under `fixtures/<name>/`, run the gate,
and if the compile grows an unlicensed dimension the gate fails — which is
the point.

## Commands (from `services/scorer/`)

- Gate (runs with the other suites): `uv run scorer-evals`
- This suite alone (needs `GEMINI_API_KEY`; spends live compile credit):

  ```
  uv run python -c "
  import json
  from pathlib import Path
  from scorer.env import load_env, require_key
  from scorer.evals_faithfulness import run_faithfulness_suite
  from scorer.genai_compat import make_client
  load_env()
  result = run_faithfulness_suite(Path('../../evals/suites/rubric_faithfulness'),
                                  make_client(require_key('GEMINI_API_KEY')))
  print(json.dumps(result, indent=2))
  "
  ```

Output lands in `evals/out/rubric_faithfulness.json` and in the
`rubric_faithfulness` block of `evals/out/regression.json`. Both name the
individual fixture and check that moved — e.g. `values-boilerplate-fdpm:
forbidden topic 'ethic' matched dimension 'ethical-judgment' (content)` —
so a failing gate says which rubric went off-JD rather than only that a
ratio changed.
