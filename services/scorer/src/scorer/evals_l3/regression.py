"""Regression gate CLI (console script: scorer-evals).

Runs evals layer 1 (rubric discrimination) and layer 3 (delivery
discrimination) when their inputs exist, compares accuracies against the
committed evals/baselines.json, and writes evals/out/regression.json.

Absent inputs are VISIBLE: a suite with no inputs is reported as SKIPPED in
the output (exit 0), never silently passing. A present suite below its
baseline fails the gate (exit 1).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from scorer.env import load_env, require_key
from scorer.evals_l1.golden import judge_discrimination
from scorer.evals_l3.delivery_check import run_delivery_discrimination
from scorer.schemas import Rubric

# src/scorer/evals_l3/regression.py -> repo root (same arithmetic as scorer.bakeoff).
REPO_ROOT = Path(__file__).resolve().parents[4].parent
DEFAULT_EVALS_ROOT = REPO_ROOT / "evals"


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scorer-evals",
        description="Run eval layers 1 and 3 and gate on committed baselines.",
    )
    parser.add_argument("--evals-root", type=Path, default=DEFAULT_EVALS_ROOT)
    parser.add_argument(
        "--rubric",
        type=Path,
        default=None,
        help="rubric JSON for layer 1 (default: rubric.json in the layer-1 suite dir)",
    )
    args = parser.parse_args(argv)

    load_env()
    evals_root: Path = args.evals_root
    baselines = json.loads((evals_root / "baselines.json").read_text())
    out_dir = evals_root / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    l1_suite = evals_root / "suites" / "rubric_discrimination"
    triplets_dir = l1_suite / "triplets"
    clips_dir = evals_root / "suites" / "delivery_discrimination" / "clips"
    has_triplets = triplets_dir.is_dir() and any(triplets_dir.glob("*.json"))
    has_clips = clips_dir.is_dir() and any(clips_dir.glob("*-fluent.wav"))

    l1_result: dict | None = None
    l3_result: dict | None = None
    l1_failure: dict | None = None
    client = None

    def _client():
        # Deferred import + lazy construction: a broken rubric with no clips
        # present must never require a GEMINI_API_KEY it will never use.
        nonlocal client
        if client is None:
            from google import genai

            client = genai.Client(api_key=require_key("GEMINI_API_KEY"))
        return client

    if has_triplets:
        rubric_path = args.rubric or l1_suite / "rubric.json"
        try:
            rubric = Rubric.model_validate_json(rubric_path.read_text())
        except (OSError, ValueError) as exc:
            # A present-but-broken rubric (missing file, bad JSON, or a failed
            # schema/integrity check -- pydantic's ValidationError is a
            # ValueError subclass) is a visible FAILURE, never a crash that
            # skips writing regression.json or running the layer-3 suite.
            l1_failure = {
                "status": "FAIL",
                "reason": f"rubric missing/unparseable: {type(exc).__name__}: {exc}",
                "baseline": baselines["rubric_discrimination_min"],
            }
        else:
            l1_result = judge_discrimination(triplets_dir, rubric, _client())
            (out_dir / "rubric_discrimination.json").write_text(json.dumps(l1_result, indent=2))
    if has_clips:
        l3_result = run_delivery_discrimination(clips_dir, _client())
        (out_dir / "delivery_discrimination.json").write_text(json.dumps(l3_result, indent=2))

    doc, exit_code = evaluate(l1_result, l3_result, baselines)
    if l1_failure is not None:
        doc["suites"]["rubric_discrimination"] = l1_failure
        doc["exit_code"] = 1
        exit_code = 1
    (out_dir / "regression.json").write_text(json.dumps(doc, indent=2))
    print(json.dumps(doc, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
