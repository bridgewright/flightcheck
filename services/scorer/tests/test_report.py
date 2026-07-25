import json, yaml
from scorer.bakeoff.report import compile_report

def test_report_renders_all_sections(tmp_path):
    out = tmp_path / "out"; out.mkdir()
    manual = tmp_path / "manual"; manual.mkdir()
    (out / "openai-latency.json").write_text(json.dumps(
        {"provider": "openai", "mode": "latency", "turns": 4,
         "latency_p50_ms": 620.0, "latency_p95_ms": 900.0,
         "disconnects": 0, "resumptions": 0, "total_minutes": 3.0}))
    (out / "openai-stability.json").write_text(json.dumps(
        {"provider": "openai", "mode": "stability", "turns": 30,
         "latency_p50_ms": 700.0, "latency_p95_ms": 1100.0,
         "disconnects": 1, "resumptions": 2, "total_minutes": 22.0}))
    (out / "discrimination.json").write_text(json.dumps(
        {"openai/gpt-audio": {"accuracy": 0.83, "trials": []}}))
    (manual / "openai-1.yaml").write_text(yaml.safe_dump(
        {"provider": "openai", "session": 1, "persona_adherence": 4,
         "pressure_persistence": 5, "interruption_naturalness": 4,
         "english_only_discipline": 5, "notes": "solid"}))
    md = compile_report(out, manual)
    assert "| openai |" in md and "620" in md and "0.83" in md
    assert "persona_adherence" in md and "Decision" in md

def test_report_flags_missing_provider(tmp_path):
    out = tmp_path / "out"; out.mkdir()
    (tmp_path / "manual").mkdir()
    md = compile_report(out, tmp_path / "manual")
    assert "MISSING" in md
