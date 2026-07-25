from scorer.evals_l3.regression import evaluate

BASELINES = {"rubric_discrimination_min": 0.8, "delivery_judge_min": 0.8}


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
