"""F-48 at the report choke point: the span contract holds for every channel.

The content judge enforces its own key spans in scorer/content/judge.py,
but DimensionScore is shared: the delivery judge's structured-output
schema (DeliveryJudgeDoc) now advertises key_span too, and that path
neither instructs nor verifies the field. compile_report is the one
choke point every stored report passes through, so it must guarantee
the stored contract itself: a key_span is an exact substring of its own
rationale (the renderer locates it by indexOf), or it is None.
"""
import logging

from scorer.report.compile import compile_report
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    DimensionScore,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)

_KEYS = [
    ("structured-answers", "Structured answers", "content"),
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
            for (key, name, channel), weight in zip(_KEYS, [0.5, 0.5], strict=True)
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your role?"],
                source="generated",
            )
        ],
        research_summary="Synthetic rubric for the span-guard tests.",
    )


def _score(key: str, **overrides) -> DimensionScore:
    fields = {
        "dimension_key": key,
        "score": 4.0,
        "evidence_quotes": [f"verbatim quote for {key}"],
        "rationale": f"Matches the anchor language for {key} at this level.",
    }
    fields.update(overrides)
    return DimensionScore(**fields)


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


def _compile(scores):
    return compile_report("sess-1", _make_rubric(), scores, _metrics(), [])


def _by_key(report):
    return {s.dimension_key: s for s in report.dimension_scores}


def test_compile_drops_a_span_not_in_its_rationale_and_logs(caplog):
    # The delivery judge's response schema advertises key_span but nothing
    # on that path verifies it; a paraphrase must not reach the stored
    # report, where the renderer would fail to locate it by indexOf.
    scores = [
        _score("structured-answers"),
        _score("pacing-control", key_span="Pace collapsed entirely at the end."),
    ]
    with caplog.at_level(logging.DEBUG, logger="scorer.report.compile"):
        report = _compile(scores)

    assert _by_key(report)["pacing-control"].key_span is None
    assert any(
        "key_span" in record.getMessage()
        and "pacing-control" in record.getMessage()
        for record in caplog.records
        if record.levelno == logging.DEBUG
    )


def test_compile_keeps_an_exact_substring_span_untouched():
    span = "the anchor language for pacing-control"
    scores = [
        _score("structured-answers"),
        _score("pacing-control", key_span=span),
    ]
    report = _compile(scores)
    stored = _by_key(report)["pacing-control"]
    assert stored.key_span == span
    assert stored.rationale.find(span) != -1


def test_compile_drops_a_blank_span():
    # "" and whitespace are substrings of everything (indexOf 0); a blank
    # emphasis must read as absent, exactly as the content path treats it.
    scores = [
        _score("structured-answers", key_span="  "),
        _score("pacing-control", key_span=""),
    ]
    report = _compile(scores)
    assert _by_key(report)["structured-answers"].key_span is None
    assert _by_key(report)["pacing-control"].key_span is None


def test_compile_leaves_absent_spans_absent():
    # Old-shape scores (no span anywhere) compile exactly as today.
    report = _compile([_score("structured-answers"), _score("pacing-control")])
    assert all(s.key_span is None for s in report.dimension_scores)
