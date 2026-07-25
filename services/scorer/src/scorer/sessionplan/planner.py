"""Baseline session planner: deterministic, no LLM.

plan_baseline_session turns a compiled rubric into the single v0.1 baseline
session plan: every rubric dimension is covered at least once (highest
weight first), one pressure probe targets the highest-weight content
dimension, and the time budget is 20 minutes. Pure function: same input,
same output. No model call, no randomness, no clock.
"""
from __future__ import annotations

from scorer.schemas import QuestionSpec, Rubric, RubricDimension, SessionPlan

_TIME_BUDGET_MINUTES = 20

_PRESSURE_PROBE_TEXT = (
    "I'm not convinced that would work in practice — walk me through why "
    "you're confident, with specifics."
)


def _generated_question(dimension: RubricDimension) -> QuestionSpec:
    """Fallback question for a dimension with no question_bank entry."""
    question = f"Tell me about a time you demonstrated {dimension.name.lower()}."
    if dimension.signals:
        question += f" I'm especially interested in {dimension.signals[0]}."
    return QuestionSpec(
        dimension_key=dimension.key,
        question=question,
        probes=[
            "What exactly did you do yourself, step by step?",
            "What was the measurable outcome?",
        ],
        source="generated",
    )


def plan_baseline_session(rubric: Rubric) -> SessionPlan:
    """Deterministic baseline plan covering every rubric dimension at least once."""
    # sorted() is stable: equal weights keep their rubric order.
    ordered = sorted(rubric.dimensions, key=lambda dim: -dim.weight)
    sequence: list[QuestionSpec] = []
    for dimension in ordered:
        banked = next(
            (q for q in rubric.question_bank if q.dimension_key == dimension.key), None)
        sequence.append(banked if banked is not None else _generated_question(dimension))
    content_dims = [dim for dim in ordered if dim.channel == "content"]
    pressure_target = content_dims[0] if content_dims else ordered[0]
    pressure_probe = QuestionSpec(
        dimension_key=pressure_target.key,
        question=_PRESSURE_PROBE_TEXT,
        probes=["Give me one concrete example that backs that up."],
        source="generated",
    )
    return SessionPlan(
        session_index=1,
        focus="baseline",
        question_sequence=sequence,
        pressure_probe=pressure_probe,
        time_budget_minutes=_TIME_BUDGET_MINUTES,
    )
