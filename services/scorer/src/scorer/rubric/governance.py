"""Peripheral-dimension governance for compiled rubrics (F-94, DECISIONS 077).

The production failure this closes: a JD's About-section mention of ethics
compiled into "AI Safety and Mission Alignment", a front-line dimension with
its own grilled question, which then scored lowest and ate a paid session's
focus. Real interviews read these areas through follow-ups and
interpretation, not dedicated questions.

Two rules, applied as a deterministic post-pass beside the faithfulness
gate (never a model call):

* Probing is unconditional: a content dimension matching the ethics/safety
  family is ALWAYS ``probing_mode="indirect"`` on newly compiled rubrics.
* Weight is conditional: when the JD's own text does not genuinely
  foreground the family (fewer than FOREGROUND_LINE_THRESHOLD distinct
  lines naming it), each peripheral weight is clamped to
  PERIPHERAL_WEIGHT_CAP and the excess redistributes proportionally across
  the other dimensions, keeping the validator's 0.01 sum tolerance. A JD
  that truly centers safety keeps its weight -- and is still read sideways.

Stored rubrics are never mutated: the schema default ("direct") preserves
their behavior on read, and only the compile path calls this module.
"""
from __future__ import annotations

import re
from collections.abc import Sequence

from scorer.schemas import Rubric, RubricDimension

# The ethics/safety family, and ONLY that family (the user scoped it
# deliberately; widening it is a product call, not a code call). Whole-word
# patterns on purpose -- the F-92 fragment-keyword lesson: "Stakeholder
# Alignment" is a real, legitimate dimension, so bare "alignment" and bare
# "mission" never classify. The pair patterns accept whitespace or hyphens
# between their words because dimension names write both ("responsible-AI").
PERIPHERAL_FAMILY_PATTERNS: tuple[str, ...] = (
    r"\bethics\b",
    r"\bethical\b",
    r"\bai[\s-]+safety\b",
    r"\bsafety\b",
    r"\bresponsible[\s-]+ai\b",
    r"\bmission[\s-]+alignment\b",
)

_FAMILY_RE = re.compile("|".join(PERIPHERAL_FAMILY_PATTERNS), re.IGNORECASE)

# D4's deterministic emphasis heuristic: this many distinct non-empty lines
# of the JD (as the model saw it) naming the family means the JD genuinely
# foregrounds it, and the compiled weight stands.
FOREGROUND_LINE_THRESHOLD = 3
PERIPHERAL_WEIGHT_CAP = 0.10


def mentions_family(text: str) -> bool:
    """Whole-word ethics/safety-family match, case-insensitive."""
    return _FAMILY_RE.search(text) is not None


def is_peripheral_dimension(dim: RubricDimension) -> bool:
    """Content dimensions whose key or name names the family.

    Excluded by rule: every delivery-channel dimension (licensed by the
    product, not the JD) and the fit dimension (by license or by key --
    motivation for the company is asked directly, whatever its name says).
    """
    if dim.channel == "delivery":
        return False
    if dim.license == "profile" or dim.key == "role-and-company-fit":
        return False
    # Each field stands alone: a joined "key name" haystack lets the pair
    # patterns match ACROSS the boundary -- key "company-mission" beside
    # name "Alignment with stakeholders" manufactured "mission alignment"
    # out of two words DECISIONS 077 says never classify on their own.
    return mentions_family(dim.key) or mentions_family(dim.name)


def jd_foregrounds_family(jd_as_shown: str) -> bool:
    """Does the JD's own text genuinely foreground the family?

    Counts DISTINCT non-empty lines containing a family keyword: one
    boilerplate sentence -- or the same sentence pasted three times -- is a
    mention, not an emphasis. The caller passes the JD exactly as the
    compiler showed it to the model (truncated, markers neutralized).
    """
    lines = {line.strip() for line in jd_as_shown.splitlines() if line.strip()}
    matching = sum(1 for line in lines if mentions_family(line))
    return matching >= FOREGROUND_LINE_THRESHOLD


def capped_weights(weights: Sequence[float],
                   peripheral: Sequence[bool]) -> list[float]:
    """Clamp peripheral weights to the cap; redistribute the excess.

    The excess spreads proportionally across the non-peripheral weights, so
    the sum is preserved to float precision (well inside the validator's
    0.01 tolerance). Degenerate inputs pass through unchanged rather than
    ever dividing by zero or emitting an invalid vector: no excess means
    nothing to move, and no non-peripheral weight means nowhere to move it
    (unreachable for a valid Rubric, which always holds a delivery
    dimension, but this function does not get to assume its caller).
    """
    pairs = list(zip(weights, peripheral, strict=True))
    excess = sum(max(0.0, weight - PERIPHERAL_WEIGHT_CAP)
                 for weight, flag in pairs if flag)
    other_total = sum(weight for weight, flag in pairs if not flag)
    if excess <= 0.0 or other_total <= 0.0:
        return list(weights)
    scale = 1.0 + excess / other_total
    return [
        min(weight, PERIPHERAL_WEIGHT_CAP) if flag else weight * scale
        for weight, flag in pairs
    ]


def apply_governance(rubric: Rubric, jd_as_shown: str) -> Rubric:
    """The deterministic post-pass: indirect always, capped conditionally.

    Also drops question_bank entries keyed to the now-indirect dimensions --
    the planner never allocates them a main question, so a banked question
    there is dead weight at best and a leak path at worst (belt and
    suspenders). Returns a Rubric rebuilt through model validation so the
    integrity validator re-runs on the governed weights. Never calls a
    model.
    """
    flags = [is_peripheral_dimension(dim) for dim in rubric.dimensions]
    if not any(flags):
        return rubric
    weights = [dim.weight for dim in rubric.dimensions]
    if not jd_foregrounds_family(jd_as_shown):
        weights = capped_weights(weights, flags)
    dimensions = [
        dim.model_copy(update={
            "probing_mode": "indirect" if flag else dim.probing_mode,
            "weight": weight,
        })
        for dim, flag, weight in zip(rubric.dimensions, flags, weights,
                                     strict=True)
    ]
    indirect_keys = {dim.key for dim, flag
                     in zip(rubric.dimensions, flags, strict=True) if flag}
    question_bank = [question for question in rubric.question_bank
                     if question.dimension_key not in indirect_keys]
    governed = rubric.model_copy(update={
        "dimensions": dimensions,
        "question_bank": question_bank,
    })
    return Rubric.model_validate(governed.model_dump())
