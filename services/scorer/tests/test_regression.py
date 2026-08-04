import json

from scorer.evals_l3.regression import build_parser, evaluate, main

# Mirrors evals/baselines.json. A gate that tolerated a missing key would
# silently stop gating that suite, so regression.py reads them directly.
BASELINES = {
    "rubric_discrimination_min": 0.8,
    "delivery_judge_min": 0.8,
    "injection_hostile_recall_min": 0.9,
    "injection_benign_false_positive_max": 0.0,
}


def _help_words() -> str:
    """--help with hyphens and line breaks flattened, so a match is about
    the words and not about where argparse wrapped them."""
    return " ".join(build_parser().format_help().replace("-", " ").split())


def test_the_cli_help_names_every_suite_it_gates():
    """A reviewer runs --help, not the module docstring.

    Derived from the suites `evaluate` actually writes rather than a
    hand-kept list, because the hand-kept version said "layers 1 and 3"
    while three suites were gated.
    """
    doc, _ = evaluate(None, None, BASELINES)
    help_text = _help_words()

    assert doc["suites"], "the fixture must produce the gated suite list"
    for suite in doc["suites"]:
        assert suite.replace("_", " ") in help_text, (
            f"{suite} is gated by this tool but is not named in its --help"
        )


def test_the_cli_help_says_where_it_has_to_be_run_from():
    """`uv run scorer-evals` fails from the repo root: the console script is
    declared in services/scorer/pyproject.toml and resolves only there."""
    help_text = _help_words()

    assert "cd services/scorer" in help_text
    assert "uv run scorer evals" in help_text  # hyphens flattened by _help_words


def test_exit_1_when_a_present_suite_is_below_baseline():
    l1 = {"trials": 4, "correct": 2, "accuracy": 0.5, "failures": []}
    l3 = {"triplets": 2, "dsp_pass": 2, "judge_pass": 2, "failures": []}

    doc, exit_code = evaluate(l1, l3, BASELINES)

    assert exit_code == 1
    assert doc["exit_code"] == 1
    assert doc["suites"]["rubric_discrimination"]["status"] == "FAIL"
    assert doc["suites"]["rubric_discrimination"]["accuracy"] == 0.5
    assert doc["suites"]["rubric_discrimination"]["baseline"] == 0.8
    assert doc["suites"]["delivery_discrimination"]["status"] == "PASS"
    assert doc["suites"]["delivery_discrimination"]["judge_accuracy"] == 1.0


def test_exit_0_when_all_present_suites_meet_baselines():
    l1 = {"trials": 5, "correct": 4, "accuracy": 0.8, "failures": []}
    l3 = {"triplets": 5, "dsp_pass": 3, "judge_pass": 4, "failures": []}

    doc, exit_code = evaluate(l1, l3, BASELINES)

    assert exit_code == 0
    assert doc["exit_code"] == 0
    assert doc["suites"]["rubric_discrimination"]["status"] == "PASS"
    assert doc["suites"]["delivery_discrimination"]["status"] == "PASS"
    # DSP separability is recorded for visibility but not gated in v0.1.
    assert doc["suites"]["delivery_discrimination"]["dsp_pass"] == 3


def test_absent_suites_are_visible_as_skipped_not_passing():
    doc, exit_code = evaluate(None, None, BASELINES)

    assert exit_code == 0
    l1 = doc["suites"]["rubric_discrimination"]
    l3 = doc["suites"]["delivery_discrimination"]
    assert l1["status"] == "SKIPPED"
    assert "triplets" in l1["reason"]
    assert l3["status"] == "SKIPPED"
    assert "clips" in l3["reason"]
    assert "accuracy" not in l1
    assert "judge_accuracy" not in l3


def test_judge_below_baseline_fails_even_if_dsp_is_perfect():
    l3 = {"triplets": 4, "dsp_pass": 4, "judge_pass": 2, "failures": []}

    doc, exit_code = evaluate(None, l3, BASELINES)

    assert exit_code == 1
    assert doc["suites"]["delivery_discrimination"]["status"] == "FAIL"
    assert doc["suites"]["rubric_discrimination"]["status"] == "SKIPPED"


def test_main_reports_skips_and_exits_zero_without_inputs(tmp_path, capsys):
    (tmp_path / "baselines.json").write_text(json.dumps(BASELINES))

    exit_code = main(["--evals-root", str(tmp_path)])

    assert exit_code == 0
    written = json.loads((tmp_path / "out" / "regression.json").read_text())
    assert written["suites"]["rubric_discrimination"]["status"] == "SKIPPED"
    assert written["suites"]["delivery_discrimination"]["status"] == "SKIPPED"
    printed = capsys.readouterr().out
    assert "SKIPPED" in printed


def test_main_missing_rubric_with_triplets_present_is_a_visible_failure(tmp_path):
    # A present-but-broken rubric must never crash main() before a verdict is
    # written -- it is a structured FAIL, not a silent skip and not a raw
    # traceback. No clips are present, so this must also never require a
    # GEMINI_API_KEY (hermetic, no network).
    (tmp_path / "baselines.json").write_text(json.dumps(BASELINES))
    triplets_dir = tmp_path / "suites" / "rubric_discrimination" / "triplets"
    triplets_dir.mkdir(parents=True)
    (triplets_dir / "some-dimension-1.json").write_text("{}")
    # suites/rubric_discrimination/rubric.json is intentionally absent.

    exit_code = main(["--evals-root", str(tmp_path)])

    assert exit_code == 1
    written = json.loads((tmp_path / "out" / "regression.json").read_text())
    assert written["exit_code"] == 1
    rubric_suite = written["suites"]["rubric_discrimination"]
    assert rubric_suite["status"] == "FAIL"
    assert "rubric" in rubric_suite["reason"]
    assert written["suites"]["delivery_discrimination"]["status"] == "SKIPPED"
