"""F-48 + F-03b at the report boundary: judge-authored fields in the stored report.

The judge now authors, per dimension, key_span and the strengths/weaknesses
lists; compile_report carries them into the stored report's dimension_scores
and lints the authored prose like every other free-text field the report
ships. The deterministic headline stays independent of judge output, and a
report stored before either field existed parses with the defaults.
"""
import pytest

from scorer.report.compile import ReportLanguageError, compile_report
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    DimensionScore,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SessionReport,
    SourceCitation,
    TimestampedObservation,
)

_KEYS = [
    ("structured-answers", "Structured answers", "content"),
    ("quantified-impact", "Quantified impact", "content"),
    ("pacing-control", "Pacing control", "delivery"),
]


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}."),
        ],
        signals=[f"{name}: named specifics"],
        citations=[
            SourceCitation(
                url="https://example.com/guide",
                title="Example guide",
                snippet=f"Interviewers probe {lowered}.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim(key, name, channel, weight)
            for (key, name, channel), weight in zip(
                _KEYS, [0.4, 0.3, 0.3], strict=True
            )
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your role?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric for the authored-fields report tests.",
    )


def _score(key: str, value: float, **overrides) -> DimensionScore:
    fields = {
        "dimension_key": key,
        "score": value,
        "evidence_quotes": [f"verbatim quote for {key}"],
        "rationale": f"Matches the anchor language for {key} at this level.",
    }
    fields.update(overrides)
    return DimensionScore(**fields)


def _scores(values: list[float]) -> list[DimensionScore]:
    return [
        _score(key, value)
        for (key, _, _), value in zip(_KEYS, values, strict=True)
    ]


def _metrics() -> DeliveryMetrics:
    return DeliveryMetrics(
        wpm_overall=142.0,
        wpm_timeline=[150.0, 134.0],
        silence_events=[],
        filler_count=6,
        filler_rate_per_min=2.1,
        f0_variance=310.5,
        avg_response_latency_s=1.3,
    )


def _obs() -> list[TimestampedObservation]:
    return [
        TimestampedObservation(
            at_s=64.2,
            kind="long-pause",
            note="Pause of 1.4 seconds observed at 01:04.",
        )
    ]


def test_judge_authored_fields_flow_into_the_stored_report():
    scores = _scores([4.0, 4.5, 4.0])
    scores[0] = _score(
        "structured-answers",
        4.0,
        rationale="Leads with a conclusion. Detail stays thin later on.",
        key_span="Detail stays thin later on.",
        strengths=["Named the metric and the timeframe without prompting."],
        weaknesses=["No trade-off was weighed before the recommendation."],
    )
    report = compile_report(
        "sess-1", _make_rubric(), scores, _metrics(), _obs()
    )
    stored = report.dimension_scores[0]
    assert stored.key_span == "Detail stays thin later on."
    assert stored.strengths == [
        "Named the metric and the timeframe without prompting."
    ]
    assert stored.weaknesses == [
        "No trade-off was weighed before the recommendation."
    ]


def test_headline_stays_deterministic_when_authored_fields_are_present():
    # The decision recorded with F-03b: the headline never consumes judge
    # prose. Verdict phrase + weakest dimension name, exactly as before.
    scores = _scores([3.2, 4.6, 4.0])
    scores[0] = _score(
        "structured-answers",
        3.2,
        key_span="Matches the anchor language for structured-answers at this level.",
        weaknesses=["The answer never returned to the question asked."],
    )
    report = compile_report(
        "sess-1", _make_rubric(), scores, _metrics(), _obs()
    )
    assert report.headline == (
        "Approaching: the performance is close to the bar; "
        "Structured answers is the widest gap."
    )


def test_lint_rejects_inner_state_assertion_in_authored_weakness():
    scores = _scores([4.0, 4.5, 4.0])
    scores[1] = _score(
        "quantified-impact",
        4.5,
        weaknesses=["Seemed nervous when the follow-up landed."],
    )
    with pytest.raises(ReportLanguageError) as err:
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    assert "nervous" in str(err.value)
    assert "quantified-impact" in str(err.value)
    assert "weaknesses" in str(err.value)


def test_lint_exempts_the_dimensions_own_quote_in_authored_strength():
    scores = _scores([4.0, 4.5, 4.0])
    scores[1] = _score(
        "quantified-impact",
        4.5,
        evidence_quotes=[
            "I was really nervous before the launch, but we cut latency by 40%."
        ],
        strengths=[
            'Owned the outcome plainly: "I was really nervous before the '
            'launch, but we cut latency by 40%."'
        ],
    )
    report = compile_report(
        "sess-1", _make_rubric(), scores, _metrics(), _obs()
    )
    assert "nervous" in report.dimension_scores[1].strengths[0].lower()


def test_lint_quote_exemption_stays_scoped_to_its_own_dimension():
    # quantified-impact's quote is the bare word "nervous"; it must not
    # exempt structured-answers' authored weakness asserting the same word.
    scores = _scores([4.0, 4.5, 4.0])
    scores[1] = _score(
        "quantified-impact", 4.5, evidence_quotes=["nervous"]
    )
    scores[0] = _score(
        "structured-answers",
        4.0,
        weaknesses=["Came across nervous in the second answer."],
    )
    with pytest.raises(ReportLanguageError) as err:
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    assert "nervous" in str(err.value)
    assert "structured-answers" in str(err.value)


def test_old_shape_stored_report_still_validates_with_defaults():
    # A report stored before F-48/F-03b (and before F-03's headline and
    # F-04's eligibility): none of the newer fields present anywhere.
    # It must parse and read back exactly as today.
    payload = {
        "session_id": "sess-legacy",
        "verdict": "approaching",
        "overall_score": 3.6,
        "dimension_scores": [
            {
                "dimension_key": key,
                "score": 3.6,
                "evidence_quotes": [f"verbatim quote for {key}"],
                "rationale": f"Matches the anchor language for {key}.",
            }
            for (key, _, _) in _KEYS
        ],
        "delivery_metrics": _metrics().model_dump(),
        "delivery_observations": [],
        "strengths": ["Quantified impact: scored 3.6/5."],
        "gaps": [],
        "next_drills": [],
        "limits_note": "This verdict reflects alignment with rubric anchors.",
    }
    report = SessionReport.model_validate(payload)
    assert report.headline == ""
    assert report.eligibility == "scored"
    for stored in report.dimension_scores:
        assert stored.key_span is None
        assert stored.strengths == []
        assert stored.weaknesses == []
