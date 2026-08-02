"""Tests for scorer.report.compile -- verdict thresholds, report copy, language lint."""
import pytest

from scorer.report.compile import ReportCompileError, ReportLanguageError, compile_report
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


def test_limited_eligibility_marks_report_and_extends_limits_note():
    # F-04: a 10-15 minute (or thin-content) session still scores, but the
    # report carries the limited marker and the limits note says so.
    report = compile_report(
        "sess-1", _make_rubric(), _scores([4.0, 4.5, 3.5, 4.0, 4.0]),
        _metrics(), _obs(), eligibility="limited",
    )
    assert report.eligibility == "limited"
    assert report.limits_note.startswith(
        "This verdict reflects alignment with rubric anchors"
    )
    assert "limited evidence" in report.limits_note


def test_default_eligibility_is_scored_with_the_fixed_limits_note():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([4.0, 4.5, 3.5, 4.0, 4.0]),
        _metrics(), _obs(),
    )
    assert report.eligibility == "scored"
    assert "limited evidence" not in report.limits_note


def test_headline_names_verdict_and_weakest_dimension():
    # F-03: always populated, deterministic, one sentence about the
    # performance -- verdict phrase + the weakest dimension by score.
    report = compile_report(
        "sess-1", _make_rubric(), _scores([3.2, 4.6, 4.1, 2.4, 3.4]), _metrics(), _obs()
    )
    assert report.headline == (
        "Approaching: the performance is close to the bar; "
        "Pacing control is the widest gap."
    )
    assert len(report.headline) <= 120


def test_headline_ready_frames_weakest_dimension_as_headroom():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([4.0, 4.5, 3.5, 4.0, 4.0]), _metrics(), _obs()
    )
    assert report.headline == (
        "Ready: the performance cleared the bar; "
        "Role knowledge has the most headroom."
    )


def test_headline_not_ready_names_the_widest_gap():
    report = compile_report(
        "sess-1", _make_rubric(), _scores([2.0, 2.5, 3.0, 2.0, 2.5]), _metrics(), _obs()
    )
    # Ties on the weakest score keep rubric order: structured-answers first.
    assert report.headline == (
        "Not yet ready: the performance sits below the bar; "
        "Structured answers is the widest gap."
    )


def test_headline_falls_back_to_short_form_for_a_long_dimension_name():
    # The 120-char ceiling is guaranteed, not aspirational: a dimension name
    # that would overflow drops the name rather than truncating mid-word.
    rubric = _make_rubric()
    long_name = (
        "Cross-functional stakeholder alignment and executive communication "
        "under ambiguous, changing requirements"
    )
    rubric = rubric.model_copy(update={"dimensions": [
        dim.model_copy(update={"name": long_name}) if dim.key == "pacing-control"
        else dim
        for dim in rubric.dimensions
    ]})
    report = compile_report(
        "sess-1", rubric, _scores([3.2, 4.6, 4.1, 2.4, 3.4]), _metrics(), _obs()
    )
    assert report.headline == "Approaching: the performance is close to the bar."
    assert len(report.headline) <= 120


def test_headline_is_linted_like_every_product_authored_field():
    # The headline embeds the rubric's dimension name; a name asserting an
    # inner state must trip the same lint as any other product copy.
    rubric = _make_rubric()
    rubric = rubric.model_copy(update={"dimensions": [
        dim.model_copy(update={"name": "Nervousness control"})
        if dim.key == "role-knowledge" else dim
        for dim in rubric.dimensions
    ]})
    with pytest.raises(ReportLanguageError) as err:
        compile_report(
            "sess-1", rubric, _scores([4.0, 4.5, 3.5, 4.0, 4.0]), _metrics(), _obs()
        )
    assert "nervous" in str(err.value)
    assert "headline" in str(err.value)


def test_lint_rejects_inner_state_assertion_in_rationale():
    scores = _scores([4.0, 4.5, 3.5, 4.0, 4.0])
    scores[2] = DimensionScore(
        dimension_key="role-knowledge",
        score=3.5,
        evidence_quotes=["verbatim quote for role-knowledge"],
        rationale="The candidate seemed Nervous when asked about metrics.",
    )
    with pytest.raises(ReportLanguageError) as err:
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    # names the pattern (matched case-insensitively) and the field it was found in
    assert "nervous" in str(err.value)
    assert "role-knowledge" in str(err.value)


def test_lint_rejects_inner_state_assertion_in_observation_note():
    with pytest.raises(ReportLanguageError) as err:
        compile_report(
            "sess-1",
            _make_rubric(),
            _scores([4.0, 4.5, 3.5, 4.0, 4.0]),
            _metrics(),
            _obs(note="You were afraid of the follow-up question."),
        )
    assert "you were afraid" in str(err.value)
    assert "delivery_observations[0].note" in str(err.value)


def test_lint_does_not_flag_forbidden_word_inside_candidate_quote():
    # The candidate's own verbatim speech says "nervous" -- that's the
    # candidate's word, not the product asserting an inner state, so it
    # must not trip the lint even though it lands inside the strengths
    # copy (which embeds evidence_quotes[0] verbatim).
    scores = _scores([4.0, 4.5, 3.5, 4.0, 4.0])
    scores[1] = DimensionScore(
        dimension_key="quantified-impact",
        score=4.5,
        evidence_quotes=[
            "I was really nervous before the launch, but we cut latency by 40%."
        ],
        rationale="Matches the anchor language for quantified-impact at this level.",
    )
    report = compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    assert "nervous" in report.strengths[0].lower()


def test_lint_still_rejects_forbidden_word_outside_any_quote_in_rationale():
    scores = _scores([4.0, 4.5, 3.5, 4.0, 4.0])
    scores[2] = DimensionScore(
        dimension_key="role-knowledge",
        score=3.5,
        evidence_quotes=["verbatim quote for role-knowledge"],
        rationale="The candidate seemed Nervous when asked about metrics.",
    )
    with pytest.raises(ReportLanguageError) as err:
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    assert "nervous" in str(err.value)
    assert "role-knowledge" in str(err.value)


def test_lint_rejects_forbidden_word_outside_quote_even_when_a_clean_quote_is_present():
    # A field can carry both an exempt quote and product-authored prose;
    # only the quote is stripped, so a forbidden word elsewhere in the same
    # field still raises.
    scores = _scores([4.0, 4.5, 3.5, 4.0, 4.0])
    scores[2] = DimensionScore(
        dimension_key="role-knowledge",
        score=3.5,
        evidence_quotes=["I shipped the migration a week early."],
        rationale=(
            'The candidate said "I shipped the migration a week early" but '
            "still seemed Nervous about the follow-up question."
        ),
    )
    with pytest.raises(ReportLanguageError) as err:
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    assert "nervous" in str(err.value)
    assert "role-knowledge" in str(err.value)


def test_lint_rejects_cross_dimension_word_collision_with_another_dimensions_quote():
    # quantified-impact's own evidence quote happens to be the bare word
    # "nervous" -- that must exempt ONLY quantified-impact's fields (e.g.
    # its strengths line, since it's embedded verbatim there), never
    # role-knowledge's unrelated, product-authored rationale that asserts
    # the same word as a genuine inner-state claim.
    scores = _scores([4.0, 4.5, 3.5, 4.0, 4.0])
    scores[1] = DimensionScore(
        dimension_key="quantified-impact",
        score=4.5,
        evidence_quotes=["nervous"],
        rationale="Matches the anchor language for quantified-impact at this level.",
    )
    scores[2] = DimensionScore(
        dimension_key="role-knowledge",
        score=3.5,
        evidence_quotes=["verbatim quote for role-knowledge"],
        rationale="The candidate seemed nervous when asked about metrics.",
    )
    with pytest.raises(ReportLanguageError) as err:
        compile_report("sess-1", _make_rubric(), scores, _metrics(), _obs())
    assert "nervous" in str(err.value)
    assert "role-knowledge" in str(err.value)
