"""Rubric-faithfulness eval suite: is every dimension licensed by the JD?

The production failure this measures (2026-08-04): a compiled rubric whose
top-weighted content dimension was mission alignment, licensed entirely by
research citations, against a JD that never asked for it. The customer is
then interviewed and scored against a bar their job description does not
contain. F-62's claim is that the compiler stays grounded in the JD even
when the research findings are salted with plausible off-JD topics -- and a
claim like that is gated the same way the injection defence is: committed
fixtures, a committed baseline, and a suite that fails the release when
grounding regresses.

Unlike the injection suite this one is NOT free: each fixture costs one
live compile_rubric call (the compiler's internal repair retry is the only
smoothing mechanism -- the runner adds no retries of its own). The research
sweep is stubbed by committing findings.json per fixture, which is what
keeps a fixture at 1-2 model calls instead of the ~7 a live sweep would
add. Every CHECK, however, is deterministic given the compile output:

* **machinery** -- every content dimension carries a non-empty jd_evidence
  that is an exact substring (strict `in`, no whitespace salvage --
  deliberately stricter than the compiler, so a compiler regression that
  stores a normalized string instead of a haystack slice is caught) of the
  same processed JD the compiler compared against:
  neutralize_markers(jd_text[:jd_compile_max_chars]).
* **behavior** -- per-fixture expectations.json: no dimension in either
  channel matches a forbidden topic, every required topic matches at least
  one dimension, and the delivery-channel count stays in its band.
* **governance** (F-94, DECISIONS 078) -- every content dimension matching
  the peripheral ethics/safety family carries probing_mode "indirect", and
  when the fixture declares the family not-foregrounded
  (expectations.json: "peripheral_family_foregrounded": false) each such
  dimension's weight also respects the 0.10 cap. A fixture declaring it
  foregrounded (ai-safety-genuine) is the indirect-but-uncapped case.

A compile refusal (RubricCompileError) is a named fixture failure, never a
crash: the pathological JD is a paying user's JD, and the product must
compile it WITHOUT the unlicensed dimensions, not refuse it.

Failures are named per the house rule -- a failing gate says WHICH fixture
and WHICH check moved, e.g. "values-boilerplate-fdpm: forbidden topic
'ethic' matched dimension 'ethical-judgment' (content)".
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from scorer.config import load_product_config
from scorer.promptsafe import neutralize_markers
from scorer.rubric.compiler import RubricCompileError, compile_rubric
from scorer.rubric.governance import PERIPHERAL_WEIGHT_CAP, is_peripheral_dimension
from scorer.schemas import CandidateProfile, GenAIClientLike, ResearchFindings, Rubric


def _empty_profile() -> CandidateProfile:
    """Fixtures pin the JD-vs-findings tension; a profile would blur it."""
    return CandidateProfile(name=None, headline=None, years_experience=None,
                            roles=[], skills=[], achievements=[])


def _machinery_problems(rubric: Rubric, processed_jd: str) -> list[str]:
    """Every content dimension quotes the JD verbatim, exactly."""
    problems: list[str] = []
    for dim in rubric.dimensions:
        # License validation runs for EVERY channel: a delivery dimension
        # claiming a profile license is exactly as wrong as a mis-keyed
        # content one, and the eval layer must see it independently of
        # the compiler (which already refuses it). A wrongly-licensed
        # CONTENT dimension falls through on purpose: it also owes the
        # JD-evidence problems below, and both are reported.
        wrongly_licensed = dim.license == "profile" and (
            dim.key != "role-and-company-fit" or dim.channel != "content"
        )
        if wrongly_licensed:
            problems.append(
                f"profile license is not allowed for dimension '{dim.key}'; "
                "only role-and-company-fit content may use it")
        if dim.channel != "content":
            continue  # delivery dimensions are licensed by the product, not the JD
        if dim.license == "profile" and not wrongly_licensed:
            # The legitimate fit dimension: profile-licensed, so it must
            # carry no JD quote and owes no JD evidence.
            if dim.jd_evidence is not None:
                problems.append(
                    f"profile dimension '{dim.key}' must have null jd_evidence")
            continue
        if not dim.jd_evidence:
            problems.append(f"content dimension '{dim.key}' has no jd_evidence")
        elif dim.jd_evidence not in processed_jd:
            problems.append(
                f"content dimension '{dim.key}' jd_evidence is not an exact "
                "substring of the compiled JD")
    return problems


def _behavior_problems(rubric: Rubric, expectations: dict) -> list[str]:
    """Per-fixture topic and channel-count expectations."""
    problems: list[str] = []
    labels = [(dim, f"{dim.key} {dim.name}".lower()) for dim in rubric.dimensions]
    for pattern in expectations["forbidden_topics"]:
        regex = re.compile(pattern, re.IGNORECASE)
        for dim, label in labels:
            if regex.search(label):
                problems.append(
                    f"forbidden topic '{pattern}' matched dimension "
                    f"'{dim.key}' ({dim.channel})")
    for pattern in expectations["required_topics"]:
        regex = re.compile(pattern, re.IGNORECASE)
        if not any(regex.search(label) for _dim, label in labels):
            problems.append(f"required topic '{pattern}' matched no dimension")
    low = expectations["delivery_dims_min"]
    high = expectations["delivery_dims_max"]
    delivery_count = sum(1 for dim in rubric.dimensions if dim.channel == "delivery")
    if not low <= delivery_count <= high:
        problems.append(
            f"delivery-channel count {delivery_count} outside [{low}, {high}]")
    if expectations.get("profile_dimension_required"):
        profile_dims = [dim for dim in rubric.dimensions if dim.license == "profile"]
        if [dim.key for dim in profile_dims] != ["role-and-company-fit"]:
            problems.append(
                "expected exactly one profile-licensed role-and-company-fit dimension")
    return problems


def _governance_problems(rubric: Rubric, expectations: dict) -> list[str]:
    """F-94 checks, deterministic given the compile output.

    The probing invariant is unconditional: a peripheral content dimension
    is always "indirect" on a freshly compiled rubric, whatever the JD
    says. The weight cap is conditional and needs the fixture to declare
    the family not-foregrounded -- the runner never re-derives the
    emphasis heuristic here, because the fixture's declaration is the
    expectation under test, not the mechanism that produces it.
    """
    problems: list[str] = []
    foregrounded = expectations.get("peripheral_family_foregrounded")
    for dim in rubric.dimensions:
        if not is_peripheral_dimension(dim):
            continue
        if dim.probing_mode != "indirect":
            problems.append(
                f"peripheral dimension '{dim.key}' must carry probing_mode "
                f"'indirect', got '{dim.probing_mode}'")
        if foregrounded is False and dim.weight > PERIPHERAL_WEIGHT_CAP + 1e-6:
            problems.append(
                f"peripheral dimension '{dim.key}' weight {dim.weight} "
                f"exceeds the {PERIPHERAL_WEIGHT_CAP} cap on a JD that does "
                "not foreground the family")
    return problems


def run_faithfulness_suite(suite_dir: Path,
                           client: GenAIClientLike) -> dict | None:
    """Compile every committed fixture live and check the output deterministically.

    None when suite_dir/fixtures has no fixture dirs, so the gate reports
    SKIPPED -- an absent suite is visible rather than silently green.
    """
    fixtures_root = suite_dir / "fixtures"
    if not fixtures_root.is_dir():
        return None
    fixture_dirs = sorted(path for path in fixtures_root.iterdir() if path.is_dir())
    if not fixture_dirs:
        return None

    # The same truncation the compiler applies, read from the same config,
    # so the haystack here is character-for-character the string the model saw.
    jd_limit = load_product_config().limits.jd_compile_max_chars

    failures: list[str] = []
    fixtures: dict[str, dict] = {}
    passed = 0
    for fixture_dir in fixture_dirs:
        name = fixture_dir.name
        jd_text = (fixture_dir / "jd.md").read_text()
        findings = ResearchFindings.model_validate_json(
            (fixture_dir / "findings.json").read_text())
        expectations = json.loads((fixture_dir / "expectations.json").read_text())
        profile_path = fixture_dir / "profile.json"
        profile = (
            CandidateProfile.model_validate_json(profile_path.read_text())
            if profile_path.is_file()
            else _empty_profile()
        )

        problems: list[str] = []
        dimensions: list[dict] = []
        try:
            # ONE compile per fixture; corpus and fewshots empty so the only
            # sources in tension are the JD and the (salted) findings.
            rubric = compile_rubric(jd_text, profile, findings,
                                    [], [], client)
        except RubricCompileError as exc:
            problems.append(f"compile failed: {exc}")
        else:
            processed_jd = neutralize_markers(jd_text[:jd_limit])
            problems.extend(_machinery_problems(rubric, processed_jd))
            problems.extend(_behavior_problems(rubric, expectations))
            problems.extend(_governance_problems(rubric, expectations))
            dimensions = [
                {"key": dim.key, "channel": dim.channel, "weight": dim.weight,
                 "license": dim.license,
                 "has_jd_evidence": bool(dim.jd_evidence),
                 "probing_mode": dim.probing_mode}
                for dim in rubric.dimensions
            ]

        if not problems:
            passed += 1
        failures.extend(f"{name}: {problem}" for problem in problems)
        fixtures[name] = {
            "status": "PASS" if not problems else "FAIL",
            "problems": problems,
            "dimensions": dimensions,
        }

    total = len(fixture_dirs)
    return {
        "fixtures_total": total,
        "fixtures_passed": passed,
        "pass_rate": passed / total,
        "failures": failures,
        "fixtures": fixtures,
    }
