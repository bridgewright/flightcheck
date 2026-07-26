import json

import pytest

from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.content.judge import ContentJudgeError, ContentScoreDoc, score_content
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
    TranscriptSegment,
)


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


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.2),
            _dim("quantified-impact", "Quantified impact", "content", 0.2),
            _dim("role-knowledge", "Role knowledge", "content", 0.2),
            _dim("pacing-control", "Pacing control", "delivery", 0.2),
            _dim("composure", "Composure", "delivery", 0.2),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?", "What was the measurable outcome?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric used only by content judge tests.",
    )


def _make_segments() -> list[TranscriptSegment]:
    return [
        TranscriptSegment(
            start_s=0.0,
            end_s=6.0,
            speaker="interviewer",
            text="Tell me about a project you led end to end.",
        ),
        TranscriptSegment(
            start_s=6.5,
            end_s=21.0,
            speaker="candidate",
            text=(
                "I led the churn dashboard rollout and, um, "
                "we cut churn by 12 percent in one quarter."
            ),
        ),
        TranscriptSegment(
            start_s=21.5,
            end_s=25.0,
            speaker="interviewer",
            text="What was your specific role in that rollout?",
        ),
        TranscriptSegment(
            start_s=25.5,
            end_s=38.0,
            speaker="candidate",
            text="I owned the metrics definition and ran weekly reviews with the sales team.",
        ),
    ]


def _content_score(key: str, score: float, quotes: list[str], rationale: str) -> dict:
    return {
        "dimension_key": key,
        "score": score,
        "evidence_quotes": quotes,
        "rationale": rationale,
    }


def _happy_scores() -> list[dict]:
    return [
        _content_score(
            "structured-answers",
            4.0,
            ["I owned the metrics definition and ran weekly reviews with the sales team."],
            "Clear arc from ownership to outcome, close to the score-5 anchor's specificity.",
        ),
        _content_score(
            "quantified-impact",
            4.5,
            ["we cut churn by 12 percent in one quarter"],
            "Quantified outcome stated directly, matching the score-5 anchor.",
        ),
        _content_score(
            "role-knowledge",
            3.0,
            ["I led the churn dashboard rollout"],
            "One concrete example with thin detail, matching the score-3 anchor.",
        ),
    ]


def test_happy_path_scores_each_content_dimension_in_focused_sampled_calls():
    rubric = _make_rubric()
    segments = _make_segments()
    # Three identical samples per content dimension, in rubric order (a batched
    # all-dimensions call was measured to saturate the responsive dimension at
    # 5.0, and a single call was measured to be non-reproducible -- evals
    # layer 1, release prep).
    fake = FakeGenAI(
        [json.dumps({"scores": [doc]}) for doc in _happy_scores() for _ in range(3)]
    )

    scores = score_content(rubric, segments, fake)

    assert [s.dimension_key for s in scores] == [
        "structured-answers",
        "quantified-impact",
        "role-knowledge",
    ]
    assert scores[1].score == 4.5
    assert scores[1].evidence_quotes == ["we cut churn by 12 percent in one quarter"]

    content_dims = [d for d in rubric.dimensions if d.channel == "content"]
    assert len(fake.calls) == 3 * len(content_dims)
    for i, dim in enumerate(content_dims):
        dim_calls = fake.calls[3 * i:3 * i + 3]
        # Distinct seeds label the three draws of one dimension.
        assert [c["config"]["seed"] for c in dim_calls] == [7, 11, 13]
        for call in dim_calls:
            assert call["model"] == load_product_config().models.scorer
            assert call["config"]["response_mime_type"] == "application/json"
            assert call["config"]["response_schema"] is ContentScoreDoc
            assert call["config"]["temperature"] == 0.0

            prompt = call["contents"]
            assert (
                "[00:00] INTERVIEWER: Tell me about a project you led end to end."
                in prompt
            )
            assert "[00:06] CANDIDATE: I led the churn dashboard rollout" in prompt
            assert dim.key in prompt
            assert dim.name in prompt
            for signal in dim.signals:
                assert signal in prompt
            for anchor in dim.anchors:
                assert anchor.behavior in prompt
            # Focused call: the other content dimensions' anchors stay out.
            for other in content_dims:
                if other.key == dim.key:
                    continue
                for anchor in other.anchors:
                    assert anchor.behavior not in prompt


def test_dimension_score_is_the_mean_of_three_samples():
    rubric = _make_rubric()
    segments = _make_segments()
    happy = _happy_scores()
    # structured-answers samples disagree: 4.0, 5.0, 4.4 -> mean 4.47; quotes
    # and rationale must come from the sample closest to that mean (4.4).
    varied = [
        dict(happy[0], score=4.0, rationale="First draw."),
        dict(happy[0], score=5.0, rationale="Second draw."),
        dict(happy[0], score=4.4, rationale="Third draw."),
    ]
    fake = FakeGenAI(
        [json.dumps({"scores": [doc]}) for doc in varied]
        + [json.dumps({"scores": [doc]}) for doc in happy[1:] for _ in range(3)]
    )

    scores = score_content(rubric, segments, fake)

    assert scores[0].score == 4.47
    assert scores[0].rationale == "Third draw."


def test_fabricated_quotes_dropped_and_flagged():
    rubric = _make_rubric()
    segments = _make_segments()
    fabricated = "I scaled the platform to ten million users"
    fake = FakeGenAI(
        [
            json.dumps({"scores": [doc]})
            for doc in [
                _content_score(
                    "structured-answers",
                    4.0,
                    [
                        "I owned the metrics definition and ran weekly reviews "
                        "with the sales team.",
                        fabricated,
                    ],
                    "Clear ownership story.",
                ),
                _content_score(
                    "quantified-impact",
                    4.5,
                    [fabricated],
                    "Strong quantified outcome.",
                ),
                _content_score(
                    "role-knowledge",
                    3.0,
                    ["I led   the churn\ndashboard rollout"],
                    "One concrete example.",
                ),
            ]
            for _ in range(3)
        ]
    )

    by_key = {s.dimension_key: s for s in score_content(rubric, segments, fake)}

    assert by_key["structured-answers"].evidence_quotes == [
        "I owned the metrics definition and ran weekly reviews with the sales team."
    ]
    assert by_key["quantified-impact"].evidence_quotes == []
    assert by_key["quantified-impact"].rationale == (
        "[no verifiable quote] Strong quantified outcome."
    )
    assert by_key["quantified-impact"].score == 4.5
    # Whitespace differences alone must not disqualify a real quote (comparison is
    # whitespace-normalized), and the quote is kept exactly as the judge returned it.
    assert by_key["role-knowledge"].evidence_quotes == ["I led   the churn\ndashboard rollout"]
    assert not by_key["role-knowledge"].rationale.startswith("[no verifiable quote] ")


def test_missing_content_dimension_raises_after_the_one_retry():
    # role-knowledge's first sample answers with the wrong dimension key, and
    # so does its retry -- the per-dimension retry budget is spent, so
    # role-knowledge never gets a score and the run fails.
    happy = _happy_scores()
    wrong_key = json.dumps({"scores": [happy[0]]})
    fake = FakeGenAI(
        [json.dumps({"scores": [doc]}) for doc in happy[:2] for _ in range(3)]
        + [wrong_key, wrong_key]
    )
    with pytest.raises(ContentJudgeError, match="role-knowledge"):
        score_content(_make_rubric(), _make_segments(), fake)


def test_one_bad_sample_is_retried_once_and_the_run_survives():
    # structured-answers' first sample is unparseable; the retry (same seed)
    # succeeds, so scoring completes with exactly one extra call.
    rubric = _make_rubric()
    happy = _happy_scores()
    fake = FakeGenAI(
        ["this is not json"]
        + [json.dumps({"scores": [happy[0]]})] * 3
        + [json.dumps({"scores": [doc]}) for doc in happy[1:] for _ in range(3)]
    )

    scores = score_content(rubric, _make_segments(), fake)

    assert [s.dimension_key for s in scores] == [
        "structured-answers", "quantified-impact", "role-knowledge",
    ]
    assert scores[0].score == 4.0
    content_dims = [d for d in rubric.dimensions if d.channel == "content"]
    assert len(fake.calls) == 3 * len(content_dims) + 1
    # The failed draw's seed is retried before the remaining seeds run.
    assert [c["config"]["seed"] for c in fake.calls[:4]] == [7, 7, 11, 13]


def test_two_bad_samples_for_one_dimension_fail_the_run_with_a_typed_error():
    # Parse failures surface as ContentJudgeError (never a raw pydantic
    # ValidationError) so callers keep handling one exception type.
    fake = FakeGenAI(["not json", "still not json"])
    with pytest.raises(ContentJudgeError, match="structured-answers"):
        score_content(_make_rubric(), _make_segments(), fake)


def test_delivery_dimensions_stay_out_of_prompt_and_output():
    rubric = _make_rubric()
    happy = _happy_scores()
    quantified_with_extra = json.dumps(
        {
            "scores": [
                happy[1],
                # An off-dimension delivery score in a response is dropped.
                _content_score(
                    "pacing-control",
                    2.0,
                    ["I led the churn dashboard rollout"],
                    "Rushed pacing throughout.",
                ),
            ]
        }
    )
    fake = FakeGenAI(
        [json.dumps({"scores": [happy[0]]})] * 3
        + [quantified_with_extra] * 3
        + [json.dumps({"scores": [happy[2]]})] * 3
    )

    scores = score_content(rubric, _make_segments(), fake)

    assert {s.dimension_key for s in scores} == {
        "structured-answers",
        "quantified-impact",
        "role-knowledge",
    }
    for call in fake.calls:
        prompt = call["contents"]
        assert "pacing-control" not in prompt
        assert "Pacing control" not in prompt
        for dim in rubric.dimensions:
            if dim.channel != "delivery":
                continue
            for anchor in dim.anchors:
                assert anchor.behavior not in prompt
