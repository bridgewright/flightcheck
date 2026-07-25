"""Regression gate CLI (console script: scorer-evals).

Runs evals layer 1 (rubric discrimination) and layer 3 (delivery
discrimination) when their inputs exist, compares accuracies against the
committed evals/baselines.json, and writes evals/out/regression.json.

Absent inputs are VISIBLE: a suite with no inputs is reported as SKIPPED in
the output (exit 0), never silently passing. A present suite below its
baseline fails the gate (exit 1).
"""
from __future__ import annotations


def evaluate(
    l1_result: dict | None, l3_result: dict | None, baselines: dict
) -> tuple[dict, int]:
    """Pure gate decision: per-suite verdicts plus the process exit code."""
    suites: dict[str, dict] = {}
    l1_baseline = baselines["rubric_discrimination_min"]
    if l1_result is None:
        suites["rubric_discrimination"] = {
            "status": "SKIPPED",
            "reason": "no triplets in evals/suites/rubric_discrimination/triplets",
            "baseline": l1_baseline,
        }
    else:
        accuracy = l1_result["accuracy"]
        suites["rubric_discrimination"] = {
            "status": "PASS" if accuracy >= l1_baseline else "FAIL",
            "accuracy": accuracy,
            "trials": l1_result["trials"],
            "baseline": l1_baseline,
        }
    l3_baseline = baselines["delivery_judge_min"]
    if l3_result is None:
        suites["delivery_discrimination"] = {
            "status": "SKIPPED",
            "reason": "no clips in evals/suites/delivery_discrimination/clips",
            "baseline": l3_baseline,
        }
    else:
        triplets = l3_result["triplets"]
        judge_accuracy = l3_result["judge_pass"] / triplets if triplets else 0.0
        # Only the judge accuracy is gated in v0.1; DSP separability is
        # recorded for visibility but has no committed baseline yet.
        suites["delivery_discrimination"] = {
            "status": "PASS" if judge_accuracy >= l3_baseline else "FAIL",
            "judge_accuracy": judge_accuracy,
            "dsp_pass": l3_result["dsp_pass"],
            "triplets": triplets,
            "baseline": l3_baseline,
        }
    exit_code = 1 if any(s["status"] == "FAIL" for s in suites.values()) else 0
    return {"suites": suites, "exit_code": exit_code}, exit_code
