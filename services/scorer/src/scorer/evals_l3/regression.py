"""Regression gate CLI (console script: scorer-evals).

Runs evals layer 1 (rubric discrimination), layer 3 (delivery
discrimination), the F-11b injection-defence suite, and the F-62
rubric-faithfulness suite when their inputs exist, compares them against
the committed evals/baselines.json, and writes evals/out/regression.json.

Absent inputs are VISIBLE: a suite with no inputs is reported as SKIPPED in
the output (exit 0), never silently passing. A present suite below its
baseline fails the gate (exit 1).

Three of the suites cost model credit -- the faithfulness suite is the
slowest, at one live rubric compile per fixture -- while the injection
suite is deterministic and costs nothing, which is deliberate: the defence
it measures is a classifier at intake, so its gate can run on every release
rather than being something the operator hesitates to spend on.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from scorer.env import load_env, require_key
from scorer.evals_faithfulness import run_faithfulness_suite
from scorer.evals_injection import run_injection_suite
from scorer.evals_l1.golden import judge_discrimination
from scorer.evals_l3.delivery_check import run_delivery_discrimination
from scorer.schemas import Rubric

# src/scorer/evals_l3/regression.py -> repo root (same arithmetic as scorer.bakeoff).
REPO_ROOT = Path(__file__).resolve().parents[4].parent
DEFAULT_EVALS_ROOT = REPO_ROOT / "evals"


def evaluate(
    l1_result: dict | None, l3_result: dict | None, baselines: dict,
    injection_result: dict | None = None,
    faithfulness_result: dict | None = None,
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
    recall_baseline = baselines["injection_hostile_recall_min"]
    fp_ceiling = baselines["injection_benign_false_positive_max"]
    if injection_result is None:
        suites["injection_defence"] = {
            "status": "SKIPPED",
            "reason": "no fixtures in evals/suites/injection/fixtures",
            "baseline": recall_baseline,
            "false_positive_ceiling": fp_ceiling,
        }
    else:
        recall = injection_result["hostile_recall"]
        false_positive_rate = injection_result["benign_false_positive_rate"]
        # Both directions gate, and the ceiling on false positives is the
        # strict one: a missed instruction set is still fenced, while a
        # refused real posting is a paying customer told their job
        # description is an attack.
        passed = recall >= recall_baseline and false_positive_rate <= fp_ceiling
        suites["injection_defence"] = {
            "status": "PASS" if passed else "FAIL",
            "hostile_recall": recall,
            "hostile_total": injection_result["hostile_total"],
            "benign_false_positive_rate": false_positive_rate,
            "benign_total": injection_result["benign_total"],
            "baseline": recall_baseline,
            "false_positive_ceiling": fp_ceiling,
            # Named so a failing gate says WHICH fixture moved.
            "misses": injection_result["misses"],
            "false_positives": injection_result["false_positives"],
        }
    faithfulness_baseline = baselines["rubric_faithfulness_min"]
    if faithfulness_result is None:
        suites["rubric_faithfulness"] = {
            "status": "SKIPPED",
            "reason": "no fixtures in evals/suites/rubric_faithfulness/fixtures",
            "baseline": faithfulness_baseline,
        }
    else:
        pass_rate = faithfulness_result["pass_rate"]
        suites["rubric_faithfulness"] = {
            "status": "PASS" if pass_rate >= faithfulness_baseline else "FAIL",
            "pass_rate": pass_rate,
            "fixtures_total": faithfulness_result["fixtures_total"],
            "fixtures_passed": faithfulness_result["fixtures_passed"],
            "baseline": faithfulness_baseline,
            # Named so a failing gate says WHICH fixture and WHICH check moved.
            "failures": faithfulness_result["failures"],
        }
    exit_code = 1 if any(s["status"] == "FAIL" for s in suites.values()) else 0
    return {"suites": suites, "exit_code": exit_code}, exit_code


def build_parser() -> argparse.ArgumentParser:
    """The CLI surface. Separate from main so --help is under test: the
    description named two of the three gated suites for three releases."""
    parser = argparse.ArgumentParser(
        prog="scorer-evals",
        description=(
            "Run the four gated eval suites and compare each against the\n"
            "committed baselines in evals/baselines.json: layer 1 rubric\n"
            "discrimination, layer 3 delivery discrimination, the\n"
            "injection-defence suite, and the rubric-faithfulness suite\n"
            "(committed JD fixtures compiled live, output checked\n"
            "deterministically). A suite whose inputs are absent is\n"
            "reported SKIPPED, never silently passed."
        ),
        epilog=(
            "Run from services/scorer. `scorer-evals` is a console script\n"
            "declared in that project's pyproject.toml, so it does not "
            "resolve\nfrom the repo root:\n\n"
            "    cd services/scorer\n"
            "    uv run scorer-evals\n\n"
            "Paths do not depend on the working directory: --evals-root\n"
            "defaults to <repo>/evals, resolved from this file."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--evals-root", type=Path, default=DEFAULT_EVALS_ROOT)
    parser.add_argument(
        "--rubric",
        type=Path,
        default=None,
        help="rubric JSON for layer 1 (default: rubric.json in the layer-1 suite dir)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    load_env()
    evals_root: Path = args.evals_root
    baselines = json.loads((evals_root / "baselines.json").read_text())
    out_dir = evals_root / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    l1_suite = evals_root / "suites" / "rubric_discrimination"
    triplets_dir = l1_suite / "triplets"
    clips_dir = evals_root / "suites" / "delivery_discrimination" / "clips"
    faithfulness_suite = evals_root / "suites" / "rubric_faithfulness"
    faithfulness_fixtures = faithfulness_suite / "fixtures"
    has_triplets = triplets_dir.is_dir() and any(triplets_dir.glob("*.json"))
    has_clips = clips_dir.is_dir() and any(clips_dir.glob("*-fluent.wav"))
    # Probed here, before the lazy _client(): an absent suite must never
    # require a GEMINI_API_KEY it will never use.
    has_faithfulness_fixtures = faithfulness_fixtures.is_dir() and any(
        path.is_dir() for path in faithfulness_fixtures.iterdir())

    l1_result: dict | None = None
    l3_result: dict | None = None
    faithfulness_result: dict | None = None
    l1_failure: dict | None = None
    client = None

    def _client():
        # Deferred import + lazy construction: a broken rubric with no clips
        # present must never require a GEMINI_API_KEY it will never use.
        nonlocal client
        if client is None:
            from scorer.genai_compat import make_client

            client = make_client(require_key("GEMINI_API_KEY"))
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
    if has_faithfulness_fixtures:
        # The slowest suite: one live compile per fixture (plus the
        # compiler's internal repair retry when the model needs it).
        faithfulness_result = run_faithfulness_suite(faithfulness_suite, _client())
        (out_dir / "rubric_faithfulness.json").write_text(
            json.dumps(faithfulness_result, indent=2))
    # Deterministic and free: it always runs, and never touches _client().
    injection_result = run_injection_suite(evals_root / "suites" / "injection")
    if injection_result is not None:
        (out_dir / "injection_defence.json").write_text(
            json.dumps(injection_result, indent=2))

    doc, exit_code = evaluate(l1_result, l3_result, baselines,
                              injection_result=injection_result,
                              faithfulness_result=faithfulness_result)
    if l1_failure is not None:
        doc["suites"]["rubric_discrimination"] = l1_failure
        doc["exit_code"] = 1
        exit_code = 1
    (out_dir / "regression.json").write_text(json.dumps(doc, indent=2))
    print(json.dumps(doc, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
