"""Report compiler: weighted verdict, report copy, and the language lint.

Pure assembly -- no LLM calls. The verdict comes from product-config
thresholds applied to the weighted overall score and the per-dimension
floor. Report copy (strengths, gaps, drills) is built from rubric anchor
language so every line traces back to a BARS behavior, not to free-form
judge prose.
"""
from __future__ import annotations

from scorer.config import load_product_config
from scorer.schemas import (
    DeliveryMetrics,
    DimensionScore,
    Rubric,
    RubricDimension,
    SessionReport,
    TimestampedObservation,
)


class ReportCompileError(Exception):
    """The score set cannot be compiled (a rubric dimension has no score)."""


class ReportLanguageError(Exception):
    """A free-text report field asserts an inner state (forbidden pattern)."""


LIMITS_NOTE = (
    "This verdict reflects alignment with rubric anchors and an "
    "experienced-interviewer scoring protocol; it is not a prediction of "
    "any specific company's decision."
)

# Dimensions below this score become gap statements. Fixed product copy
# behavior (unlike the verdict thresholds, which are config).
_GAP_THRESHOLD = 3.5


def _anchor_behavior(dim: RubricDimension, target: int) -> str:
    for anchor in dim.anchors:
        if anchor.score == target:
            return anchor.behavior
    raise ReportCompileError(f"dimension {dim.key!r} has no score-{target} anchor")


def _strength_line(dim: RubricDimension, score: DimensionScore) -> str:
    if score.evidence_quotes:
        return (
            f"{dim.name}: scored {score.score:.1f}/5. "
            f'Evidence: "{score.evidence_quotes[0]}"'
        )
    return f"{dim.name}: scored {score.score:.1f}/5. {score.rationale}"


def _gap_line(dim: RubricDimension, score: DimensionScore) -> str:
    return (
        f"{dim.name}: scored {score.score:.1f}/5. "
        f"Score-5 behavior: {_anchor_behavior(dim, 5)}"
    )


def _drill_line(dim: RubricDimension) -> str:
    signal = dim.signals[0] if dim.signals else dim.name
    return (
        f"Drill for {dim.name}: record a 90-second answer and check it "
        f'against the signal "{signal}"; repeat until the answer shows the '
        "signal without prompting."
    )


def _lint_field(field: str, text: str, patterns: list[str], exempt_quotes: list[str]) -> None:
    """Report language rule: state observed signals, never inner states.

    Evidence quotes are the candidate's own verbatim speech, not the product
    asserting an inner state, so each exact quote is stripped out of the
    text (case-sensitive substring removal -- quotes are interpolated
    verbatim) before the case-insensitive pattern scan runs on what's left.
    """
    stripped = text
    for quote in exempt_quotes:
        stripped = stripped.replace(quote, "")
    lowered = stripped.lower()
    for pattern in patterns:
        if pattern.lower() in lowered:
            raise ReportLanguageError(
                f"forbidden pattern {pattern!r} in report field {field}: "
                "state observed signals, never inner states"
            )


def _verdict(overall: float, scores: list[DimensionScore], cfg) -> str:
    ready = overall >= cfg.ready_overall and all(
        s.score >= cfg.ready_min_dimension for s in scores
    )
    if ready:
        return "ready"
    if overall >= cfg.approaching_overall:
        return "approaching"
    return "not_ready"


def compile_report(
    session_id: str,
    rubric: Rubric,
    dimension_scores: list[DimensionScore],
    metrics: DeliveryMetrics,
    observations: list[TimestampedObservation],
) -> SessionReport:
    """Compile judge scores + DSP metrics into the session report."""
    cfg = load_product_config().report
    by_key = {s.dimension_key: s for s in dimension_scores}
    missing = [d.key for d in rubric.dimensions if d.key not in by_key]
    if missing:
        raise ReportCompileError(f"no score for rubric dimensions: {missing}")

    dims_by_key = {d.key: d for d in rubric.dimensions}
    ordered = [by_key[d.key] for d in rubric.dimensions]
    # Round to 2 decimals so threshold comparisons never hinge on binary
    # float dust (0.2 * 4.5 is not exactly 0.9 in floating point).
    overall = round(sum(by_key[d.key].score * d.weight for d in rubric.dimensions), 2)

    # sorted() is stable: ties keep rubric order in both directions.
    ranked = sorted(ordered, key=lambda s: s.score, reverse=True)
    weakest_first = sorted(ordered, key=lambda s: s.score)
    strengths = [_strength_line(dims_by_key[s.dimension_key], s) for s in ranked[:2]]
    gaps = [
        _gap_line(dims_by_key[s.dimension_key], s)
        for s in weakest_first
        if s.score < _GAP_THRESHOLD
    ]
    next_drills = [_drill_line(dims_by_key[s.dimension_key]) for s in weakest_first[:2]]

    # Language lint over every free-text field the product writes. Evidence
    # quotes are exempt: they are the candidate's verbatim speech, not the
    # product asserting an inner state. Any embedded quote is stripped out
    # of a field's text before that field is scanned, so a forbidden word
    # inside a candidate's own quote never trips the lint, no matter which
    # field (strengths, gaps, drills, rationale, observation note) it
    # appears in.
    exempt_quotes = [q for s in dimension_scores for q in s.evidence_quotes]
    for score in ordered:
        _lint_field(
            f"dimension_scores[{score.dimension_key}].rationale",
            score.rationale,
            cfg.forbidden_patterns,
            exempt_quotes,
        )
    for i, obs in enumerate(observations):
        _lint_field(
            f"delivery_observations[{i}].note", obs.note, cfg.forbidden_patterns, exempt_quotes
        )
    for name, lines in (
        ("strengths", strengths),
        ("gaps", gaps),
        ("next_drills", next_drills),
    ):
        for i, line in enumerate(lines):
            _lint_field(f"{name}[{i}]", line, cfg.forbidden_patterns, exempt_quotes)

    return SessionReport(
        session_id=session_id,
        verdict=_verdict(overall, ordered, cfg),
        overall_score=overall,
        dimension_scores=ordered,
        delivery_metrics=metrics,
        delivery_observations=observations,
        strengths=strengths,
        gaps=gaps,
        next_drills=next_drills,
        limits_note=LIMITS_NOTE,
    )
