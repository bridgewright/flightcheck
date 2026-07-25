from __future__ import annotations

import json
from pathlib import Path

import yaml

PROVIDERS = ["openai", "gemini"]
MANUAL_KEYS = ["persona_adherence", "pressure_persistence",
               "interruption_naturalness", "english_only_discipline"]
HEADER = """# S2S Provider Bake-off — 2026-08-02

Method: DECISIONS.md #002. Automated runs via `make bakeoff-*`; manual sessions per
`evals/suites/bakeoff/manual_protocol.md`. Criteria ordered by lethality:
stability > latency > interruption > persona > (scoring channel) audio discrimination.
"""


def _load(out_dir: Path, name: str) -> dict | None:
    p = out_dir / name
    return json.loads(p.read_text()) if p.exists() else None


def compile_report(out_dir: Path, manual_dir: Path) -> str:
    # turns = answered, attempted = committed: their gap is silently-dropped
    # turns. errors = session.error events, which no earlier table counted.
    cols = ["provider", "mode", "turns", "attempted", "p50 ms", "p95 ms",
            "disconnects", "errors", "resumptions", "minutes"]
    lines = [HEADER, "## Automated metrics", "",
             "| " + " | ".join(cols) + " |",
             "| " + " | ".join("---" for _ in cols) + " |"]
    for prov in PROVIDERS:
        for mode in ("latency", "stability"):
            s = _load(out_dir, f"{prov}-{mode}.json")
            if s is None:
                lines.append(f"| {prov} | {mode} | MISSING |" + " |" * (len(cols) - 3))
            else:
                lines.append(f"| {prov} | {mode} | {s['turns']} | "
                             f"{s.get('turns_attempted', '')} | {s['latency_p50_ms']} | "
                             f"{s['latency_p95_ms']} | {s['disconnects']} | "
                             f"{s.get('errors', '')} | "
                             f"{s['resumptions']} | {s['total_minutes']} |")
    lines += ["", "## Manual session ratings (1–5)", "",  # noqa: RUF001 — en dash is prose, not code
              "| provider | session | " + " | ".join(MANUAL_KEYS) + " | notes |",
              "| --- | --- | " + " | ".join("---" for _ in MANUAL_KEYS) + " | --- |"]
    sheets = sorted(f for f in manual_dir.glob("*.yaml") if f.name != "sheet-template.yaml")
    if not sheets:
        lines.append("| MISSING | | " + " | ".join("" for _ in MANUAL_KEYS) + " | |")
    for f in sheets:
        d = yaml.safe_load(f.read_text())
        lines.append(f"| {d['provider']} | {d['session']} | "
                     + " | ".join(str(d[k]) for k in MANUAL_KEYS) + f" | {d['notes']} |")
    lines += ["", "## Scoring-channel audio discrimination", ""]
    disc = _load(out_dir, "discrimination.json")
    if disc is None:
        lines.append("MISSING — run `make bakeoff-discrimination`.")
    else:
        # trial count is per model and comes from the data: the protocol is
        # 2 questions x 6 permutations, minus whatever failed to parse.
        lines += ["| model | trials | ranking accuracy | parse failures |",
                  "| --- | --- | --- | --- |"]
        lines += [f"| {m} | {len(v.get('trials', []))} | {v['accuracy']:.2f} | "
                  f"{v.get('parse_failures', '')} |" for m, v in disc.items()]
    lines += ["", "## Decision", "",
              "_Filled by hand on 2026-08-02 and mirrored to DECISIONS.md #002:_",
              "- Live interviewer provider: ",
              "- Scoring-channel audio model: ",
              "- Key trade-off accepted: ", ""]
    return "\n".join(lines)


def main() -> None:
    base = Path(__file__).resolve().parents[4].parent / "evals"
    md = compile_report(base / "suites" / "bakeoff" / "out", base / "suites" / "bakeoff" / "manual")
    target = base / "reports" / "2026-08-02-provider-bakeoff.md"
    target.write_text(md)
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
