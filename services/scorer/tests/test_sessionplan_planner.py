"""Tests for scorer.sessionplan.planner -- deterministic planning, no LLM."""
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)
from scorer.sessionplan.planner import plan_baseline_session

PRESSURE_PROBE_TEXT = (
    "I'm not convinced that would work in practice — walk me through why "
    "you're confident, with specifics."
)


def _dim(key: str, name: str, channel: str, weight: float,
         signals: list[str] | None = None) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}: vague claims, no example."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}: one example, thin detail."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}: specific, quantified."),
        ],
        signals=[f"{name}: named specifics"] if signals is None else signals,
        citations=[
            SourceCitation(
                url="https://example.com/interview-guide",
                title="Example interview guide",
                snippet=f"Interviewers probe {lowered} with follow-up questions.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.15),
            _dim("quantified-impact", "Quantified impact", "content", 0.3),
            _dim("role-knowledge", "Role knowledge", "content", 0.15),
            _dim("pacing-control", "Pacing control", "delivery", 0.35),
            _dim("composure", "Composure", "delivery", 0.05, signals=[]),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="quantified-impact",
                question="Tell me about a result you are most proud of, with numbers.",
                probes=["What was the baseline before your change?"],
                source="research-sweep",
            ),
            QuestionSpec(
                dimension_key="quantified-impact",
                question="Second banked question that must not be picked.",
                probes=[],
                source="research-sweep",
            ),
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?", "What was the measurable outcome?"],
                source="research-sweep",
            ),
        ],
        research_summary="Synthetic rubric used only by session planner tests.",
    )


def test_plan_covers_every_dimension_by_descending_weight():
    plan = plan_baseline_session(_make_rubric())
    assert [q.dimension_key for q in plan.question_sequence] == [
        "pacing-control",
        "quantified-impact",
        "structured-answers",
        "role-knowledge",
        "composure",
    ]


def test_plan_picks_first_bank_entry_per_dimension():
    plan = plan_baseline_session(_make_rubric())
    by_key = {q.dimension_key: q for q in plan.question_sequence}
    assert by_key["quantified-impact"].question == (
        "Tell me about a result you are most proud of, with numbers.")
    assert by_key["quantified-impact"].source == "research-sweep"
    assert by_key["structured-answers"].question == (
        "Walk me through a project you led end to end.")


def test_plan_generates_fallback_question_with_name_and_top_signal():
    plan = plan_baseline_session(_make_rubric())
    by_key = {q.dimension_key: q for q in plan.question_sequence}
    generated = by_key["pacing-control"]
    assert generated.source == "generated"
    assert generated.question == (
        "Tell me about a time you demonstrated pacing control. "
        "I'm especially interested in Pacing control: named specifics.")
    assert generated.probes == [
        "What exactly did you do yourself, step by step?",
        "What was the measurable outcome?",
    ]


def test_plan_generated_question_without_signals_stays_one_sentence():
    plan = plan_baseline_session(_make_rubric())
    by_key = {q.dimension_key: q for q in plan.question_sequence}
    assert by_key["composure"].question == "Tell me about a time you demonstrated composure."


def test_pressure_probe_targets_highest_weight_content_dimension():
    plan = plan_baseline_session(_make_rubric())
    # pacing-control has the highest weight overall but is delivery-channel;
    # the pressure probe must land on the heaviest CONTENT dimension.
    assert plan.pressure_probe.dimension_key == "quantified-impact"
    assert plan.pressure_probe.question == PRESSURE_PROBE_TEXT
    assert plan.pressure_probe.source == "generated"


def test_plan_fixed_fields():
    plan = plan_baseline_session(_make_rubric())
    assert plan.session_index == 1
    assert plan.focus == "baseline"
    assert plan.time_budget_minutes == 20
