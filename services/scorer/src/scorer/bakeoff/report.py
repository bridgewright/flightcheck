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
    lines = [HEADER, "## Automated metrics", "",
             "| provider | mode | turns | p50 ms | p95 ms | disconnects | resumptions | minutes |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for prov in PROVIDERS:
        for mode in ("latency", "stability"):
            s = _load(out_dir, f"{prov}-{mode}.json")
            if s is None:
                lines.append(f"| {prov} | {mode} | MISSING | | | | | |")
            else:
                lines.append(f"| {prov} | {mode} | {s['turns']} | {s['latency_p50_ms']} | "
                             f"{s['latency_p95_ms']} | {s['disconnects']} | "
                             f"{s['resumptions']} | {s['total_minutes']} |")
    lines += ["", "## Manual session ratings (1–5)", "",
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
        lines += ["| model | ranking accuracy (36 trials) |", "| --- | --- |"]
        lines += [f"| {m} | {v['accuracy']:.2f} |" for m, v in disc.items()]
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
