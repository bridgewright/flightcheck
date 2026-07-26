# evals/

The product's trust lives here. A release ships only when suites pass
(`uv run scorer-evals` from `services/scorer/`, exit 0, gated against
`baselines.json`).

## Layout

- `suites/` — runnable checks and their committed inputs:
  - `bakeoff/` — W1 S2S provider bake-off (latency, stability, audio
    discrimination). Its run outputs are committed under `bakeoff/out/`.
  - `rubric_discrimination/` — evals layer 1: golden answer triplets against
    the committed eval rubric. **The evaluation criteria of record (the
    BARS-anchored rubric) live here**, at
    `suites/rubric_discrimination/rubric.json` — compiled by the product
    pipeline from a representative public JD.
  - `delivery_discrimination/` — evals layer 3: controlled delivery clip
    triplets (clips themselves gitignored, DECISIONS #005).
- `baselines.json` — committed accuracy floors the gate compares against.
- `reports/` — committed results: the bake-off report and, per release, the
  gate numbers of record (e.g. `reports/2026-07-26-v01-gate.md`).
- `out/` — generated run artifacts, **gitignored by convention**: local runs
  write here, and the numbers of record are committed verbatim into a
  `reports/` snapshot instead. If a public number ever disagrees with a
  fresh `out/` run, the gate — not the doc — decides.
