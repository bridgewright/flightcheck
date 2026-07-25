"""Tests for scorer.report.compile -- verdict thresholds, report copy, language lint."""
import pytest

from scorer.report.compile import ReportCompileError, compile_report
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    DimensionScore,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SilenceEvent,
    SourceCitation,
    TimestampedObservation,
)

_KEYS = [
    ("structured-answers", "Structured answers", "content"),
    ("quantified-impact", "Quantified impact", "content"),
    ("role-knowledge", "Role knowledge", "content"),
    ("pacing-control", "Pacing control", "delivery"),
    ("composure", "Composure", "delivery"),
]


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
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
        signals=[f"{name}: named specifics", f"{name}: measurable outcomes"],
        citations=[
            SourceCitation(
                url="https://example.com/interview-guide",
                title="Example interview guide",
                snippet=f"Interviewers probe {lowered} with follow-up questions.",
            )
        ],
    )


def _make_rubric(weights: list[float] | None = None) -> Rubric:
    weights = weights or [0.2] * 5
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim(key, name, channel, weight)
            for (key, name, channel), weight in zip(_KEYS, weights, strict=True)
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric used only by report compiler tests.",
    )


def _score(key: str, value: float) -> DimensionScore:
    return DimensionScore(
        dimension_key=key,
        score=value,
        evidence_quotes=[f"verbatim quote for {key}"],
        rationale=f"Matches the anchor language for {key} at this level.",
    )


def _scores(values: list[float]) -> list[DimensionScore]:
    return [_score(key, value) for (key, _, _), value in zip(_KEYS, values, strict=True)]


def _metrics() -> DeliveryMetrics:
    return DeliveryMetrics(
        wpm_overall=142.0,
        wpm_timeline=[150.0, 134.0],
        silence_events=[SilenceEvent(start_s=64.2, duration_s=1.4)],
        filler_count=6,
        filler_rate_per_min=2.1,
        f0_variance=310.5,
        avg_response_latency_s=1.3,
    )


def _obs(
    note: str = "Pause of 1.4 seconds observed at 01:04 before the answer resumed.",
) -> list[TimestampedObservation]:
    return [TimestampedObservation(at_s=64.2, kind="long-pause", note=note)]


def test_ready_when_overall_and_every_dimension_clear_thresholds():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([4.0, 4.5, 3.5, 4.0, 4.0]), _metrics(), _obs()
    )
    assert report.session_id == "sess-1"
    assert report.overall_score == 4.0
    assert report.verdict == "ready"
    assert [s.dimension_key for s in report.dimension_scores] == [k for k, _, _ in _KEYS]
    assert len(report.strengths) == 2
    assert report.gaps == []            # no dimension is below 3.5
    assert len(report.next_drills) == 2


def test_overall_exactly_four_with_a_sub_three_dimension_is_approaching():
    # weighted overall is exactly 4.0, but structured-answers at 2.9 breaks the
    # ready_min_dimension floor -> "approaching", not "ready"
    report = compile_report(
        "sess-1", _make_rubric(), _scores([2.9, 5.0, 5.0, 4.0, 3.1]), _metrics(), _obs()
    )
    assert report.overall_score == 4.0
    assert report.verdict == "approaching"


def test_below_approaching_threshold_is_not_ready():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([2.0, 2.5, 3.0, 2.0, 2.5]), _metrics(), _obs()
    )
    assert report.overall_score == 2.4
    assert report.verdict == "not_ready"


def test_overall_uses_rubric_weights_not_a_plain_mean():
    rubric = _make_rubric(weights=[0.4, 0.3, 0.15, 0.1, 0.05])
    report = compile_report(
        "sess-1", rubric, _scores([5.0, 4.0, 3.0, 2.0, 1.0]), _metrics(), _obs()
    )
    # 5*0.4 + 4*0.3 + 3*0.15 + 2*0.1 + 1*0.05 = 3.9 (a plain mean would be 3.0)
    assert report.overall_score == 3.9
    assert report.verdict == "approaching"   # the 1.0 dimension blocks "ready"


def test_missing_dimension_score_raises_compile_error():
    scores = _scores([4.0, 4.5, 3.5, 4.0, 4.0])[:-1]   # drop composure
    with pytest.raises(ReportCompileError, match="composure"):
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())


def test_limits_note_is_the_exact_fixed_sentence():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([4.0, 4.5, 3.5, 4.0, 4.0]), _metrics(), _obs()
    )
    assert report.limits_note == (
        "This verdict reflects alignment with rubric anchors and an "
        "experienced-interviewer scoring protocol; it is not a prediction of "
        "any specific company's decision."
    )


def test_strengths_gaps_and_drills_reference_dimensions():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([3.2, 4.6, 4.1, 2.4, 3.4]), _metrics(), _obs()
    )
    # strengths: top 2 by score, best first, quote-backed
    assert report.strengths[0].startswith("Quantified impact: scored 4.6/5.")
    assert '"verbatim quote for quantified-impact"' in report.strengths[0]
    assert report.strengths[1].startswith("Role knowledge: scored 4.1/5.")
    # gaps: every dimension < 3.5, lowest first, against the score-5 anchor behavior
    assert len(report.gaps) == 3
    assert report.gaps[0].startswith("Pacing control: scored 2.4/5.")
    assert "Consistently shows pacing control: specific, quantified." in report.gaps[0]
    assert report.gaps[1].startswith("Structured answers: scored 3.2/5.")
    assert report.gaps[2].startswith("Composure: scored 3.4/5.")
    # drills: the 2 lowest dimensions, each naming the dimension and one signal
    assert len(report.next_drills) == 2
    assert "Pacing control" in report.next_drills[0]
    assert "Pacing control: named specifics" in report.next_drills[0]
    assert "Structured answers" in report.next_drills[1]
