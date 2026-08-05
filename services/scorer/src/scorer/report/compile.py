"""Report compiler: weighted verdict, report copy, and the language lint.

Pure assembly -- no LLM calls. The verdict comes from product-config
thresholds applied to the weighted overall score and the per-dimension
floor. Report copy (strengths, gaps, drills) is built from rubric anchor
language so every line traces back to a BARS behavior, not to free-form
judge prose. The per-dimension key_span and strengths/weaknesses (F-48,
F-03b) are judge-authored upstream and pass through inside
dimension_scores; the authored prose is linted here like every other
free-text field the report ships.
"""
from __future__ import annotations

from typing import Literal

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

# Appended when the session cleared the F-04 floors but not the full-evidence
# bars: the numbers stand, and they are honest about their footing.
LIMITED_EVIDENCE_NOTE = (
    " This session provided limited evidence -- a shorter run or thinner "
    "responses than a full session -- so scores carry wider uncertainty."
)

# Dimensions below this score become gap statements. Fixed product copy
# behavior (unlike the verdict thresholds, which are config).
_GAP_THRESHOLD = 3.5

# F-03 headline: one deterministic sentence synthesized from the verdict and
# the weakest dimension -- always populated, never judge-authored. Kept
# deliberately independent of the judge-authored fields F-03b/F-48 added
# (key spans, per-dimension strengths/weaknesses): the judge's voice reaches
# the report through dimension_scores, while the headline is the report's
# first line, whose length ceiling and register are guaranteed here rather
# than requested from a model. Third person about the performance, never
# about the person.
_HEADLINE_MAX_CHARS = 120

_HEADLINE_TEMPLATES = {
    "ready": (
        "Ready: the performance cleared the bar; {name} has the most headroom."
    ),
    "approaching": (
        "Approaching: the performance is close to the bar; "
        "{name} is the widest gap."
    ),
    "not_ready": (
        "Not yet ready: the performance sits below the bar; "
        "{name} is the widest gap."
    ),
}

# The ceiling is guaranteed, not aspirational: a dimension name that would
# overflow drops the name entirely rather than truncating mid-word.
_HEADLINE_FALLBACKS = {
    "ready": "Ready: the performance cleared the bar.",
    "approaching": "Approaching: the performance is close to the bar.",
    "not_ready": "Not yet ready: the performance sits below the bar.",
}


def _headline(verdict: str, weakest_name: str) -> str:
    full = _HEADLINE_TEMPLATES[verdict].format(name=weakest_name)
    if len(full) <= _HEADLINE_MAX_CHARS:
        return full
    return _HEADLINE_FALLBACKS[verdict]


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
    eligibility: Literal["scored", "limited"] = "scored",
) -> SessionReport:
    """Compile judge scores + DSP metrics into the session report.

    eligibility is the F-04 verdict for sessions that were scorable at all
    ("insufficient" sessions never reach this function); "limited" marks the
    report and extends the limits note.
    """
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

    verdict = _verdict(overall, ordered, cfg)
    headline = _headline(verdict, dims_by_key[weakest_first[0].dimension_key].name)

    # Language lint over every free-text field the product writes. Evidence
    # quotes are exempt from the field they are actually embedded in -- and
    # only that field -- because they are the candidate's own verbatim
    # speech there, not the product asserting an inner state. The exemption
    # must stay scoped per-field: a short quote in one dimension (e.g.
    # "nervous") must never exempt an unrelated dimension's product-
    # authored prose that happens to contain the same word. Gaps, drills,
    # and observation notes never embed a candidate quote by construction,
    # so they get no exemption at all. The headline embeds only the rubric's
    # dimension name, never a quote, and is linted first: it is the report's
    # first line, so a violation there should be the error that surfaces.
    _lint_field("headline", headline, cfg.forbidden_patterns, [])
    for score in ordered:
        _lint_field(
            f"dimension_scores[{score.dimension_key}].rationale",
            score.rationale,
            cfg.forbidden_patterns,
            score.evidence_quotes,
        )
        # F-03b: the judge-authored per-dimension lists are free-text the
        # report ships, so they take the same lint as the rationale, with
        # the same per-dimension quote exemption (an authored item may embed
        # the candidate's own verbatim words). key_span needs no lint of its
        # own: it is enforced upstream to be a substring of the rationale
        # linted above.
        for field_name, items in (
            ("strengths", score.strengths),
            ("weaknesses", score.weaknesses),
        ):
            for i, item in enumerate(items):
                _lint_field(
                    f"dimension_scores[{score.dimension_key}].{field_name}[{i}]",
                    item,
                    cfg.forbidden_patterns,
                    score.evidence_quotes,
                )
    for i, obs in enumerate(observations):
        _lint_field(f"delivery_observations[{i}].note", obs.note, cfg.forbidden_patterns, [])
    for i, score in enumerate(ranked[:2]):
        _lint_field(
            f"strengths[{i}]", strengths[i], cfg.forbidden_patterns, score.evidence_quotes
        )
    for i, line in enumerate(gaps):
        _lint_field(f"gaps[{i}]", line, cfg.forbidden_patterns, [])
    for i, line in enumerate(next_drills):
        _lint_field(f"next_drills[{i}]", line, cfg.forbidden_patterns, [])

    limits_note = LIMITS_NOTE
    if eligibility == "limited":
        limits_note += LIMITED_EVIDENCE_NOTE

    return SessionReport(
        session_id=session_id,
        verdict=verdict,
        headline=headline,
        eligibility=eligibility,
        overall_score=overall,
        dimension_scores=ordered,
        delivery_metrics=metrics,
        delivery_observations=observations,
        strengths=strengths,
        gaps=gaps,
        next_drills=next_drills,
        limits_note=limits_note,
    )
