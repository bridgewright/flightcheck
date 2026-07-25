import json

import yaml

from scorer.bakeoff.report import compile_report

MANUAL_SHEET = {"provider": "openai", "session": 1, "persona_adherence": 4,
                "pressure_persistence": 5, "interruption_naturalness": 4,
                "english_only_discipline": 5, "notes": "solid"}
TEMPLATE_SHEET = {"provider": "", "session": 0, "persona_adherence": 0,
                  "pressure_persistence": 0, "interruption_naturalness": 0,
                  "english_only_discipline": 0, "notes": ""}


def _trials(n: int) -> list[dict]:
    return [{"model": "openai/gpt-audio", "permutation": ["fluent", "filler", "hesitant"],
             "predicted": ["A", "B", "C"], "correct": True} for _ in range(n)]


def test_report_renders_all_sections(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    manual = tmp_path / "manual"
    manual.mkdir()
    (out / "openai-latency.json").write_text(json.dumps(
        {"provider": "openai", "mode": "latency", "turns": 4, "turns_attempted": 4,
         "latency_p50_ms": 620.0, "latency_p95_ms": 900.0,
         "disconnects": 0, "errors": 0, "resumptions": 0, "send_failures": 0,
         "total_minutes": 3.0}))
    (out / "openai-stability.json").write_text(json.dumps(
        {"provider": "openai", "mode": "stability", "turns": 28, "turns_attempted": 30,
         "latency_p50_ms": 700.0, "latency_p95_ms": 1100.0,
         "disconnects": 1, "errors": 3, "resumptions": 2, "send_failures": 1,
         "total_minutes": 22.0}))
    (out / "discrimination.json").write_text(json.dumps(
        {"openai/gpt-audio": {"accuracy": 0.83, "api_failures": 0, "parse_failures": 1,
                              "trials": _trials(11)}}))
    (manual / "openai-1.yaml").write_text(yaml.safe_dump(MANUAL_SHEET))
    md = compile_report(out, manual)
    assert "| openai |" in md and "620" in md and "0.83" in md
    assert "persona_adherence" in md and "Decision" in md


def test_automated_table_shows_attempted_turns_and_errors(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    manual = tmp_path / "manual"
    manual.mkdir()
    (out / "gemini-stability.json").write_text(json.dumps(
        {"provider": "gemini", "mode": "stability", "turns": 28, "turns_attempted": 30,
         "latency_p50_ms": 700.0, "latency_p95_ms": 1100.0,
         "disconnects": 2, "errors": 3, "resumptions": 2, "send_failures": 0,
         "total_minutes": 22.0}))
    md = compile_report(out, manual)
    assert "| attempted |" in md and "| errors |" in md
    # 2 of 30 turns went unanswered and 3 errors landed — neither may be invisible
    assert "| gemini | stability | 28 | 30 | 700.0 | 1100.0 | 2 | 3 | 2 | 22.0 |" in md


def test_discrimination_trial_count_comes_from_the_data(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    manual = tmp_path / "manual"
    manual.mkdir()
    (out / "discrimination.json").write_text(json.dumps(
        {"openai/gpt-audio": {"accuracy": 0.83, "api_failures": 2, "parse_failures": 1,
                              "trials": _trials(11)}}))
    md = compile_report(out, manual)
    # protocol is 2 questions x 6 permutations = 12 per model, and a run with
    # failures has fewer — a hardcoded "36 trials" was simply wrong
    assert "| openai/gpt-audio | 11 | 0.83 | 2 | 1 |" in md
    assert "36 trials" not in md


def test_report_flags_missing_provider(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (tmp_path / "manual").mkdir()
    md = compile_report(out, tmp_path / "manual")
    assert "MISSING" in md


def test_report_ignores_manual_sheet_template(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    manual = tmp_path / "manual"
    manual.mkdir()
    (manual / "sheet-template.yaml").write_text(yaml.safe_dump(TEMPLATE_SHEET))
    (manual / "openai-1.yaml").write_text(yaml.safe_dump(MANUAL_SHEET))
    md = compile_report(out, manual)
    assert "| openai | 1 | 4 | 5 | 4 | 5 | solid |" in md
    assert "|  | 0 | 0 | 0 | 0 | 0 |  |" not in md
    assert "sheet-template" not in md


def test_report_flags_missing_when_only_template_present(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    manual = tmp_path / "manual"
    manual.mkdir()
    (manual / "sheet-template.yaml").write_text(yaml.safe_dump(TEMPLATE_SHEET))
    md = compile_report(out, manual)
    assert "| MISSING | | " in md
    assert "|  | 0 | 0 | 0 | 0 | 0 |  |" not in md
    assert "sheet-template" not in md
