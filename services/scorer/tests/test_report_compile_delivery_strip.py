"""Uninstructed delivery-authored lists are dropped at the choke point.

The delivery judge shares DimensionScore, so its response schema advertises
strengths/weaknesses, but its prompt never instructs their register. An
inner-state item volunteered there would fail the report lint and with it
the scoring run of a session that cannot be re-run. Until that judge is
instructed, compile_report drops delivery-channel lists; the key span
survives on both channels because the span guard holds it to the linted
rationale. DECISIONS 043.
"""
import logging

from test_report_compile_span_guard import _by_key, _compile, _score


def test_delivery_authored_lists_are_dropped_and_logged(caplog):
    scores = [
        _score("structured-answers"),
        _score(
            "pacing-control",
            strengths=["Held a steady pace through the technical answer."],
            weaknesses=["Trailed off before finishing the last two answers."],
        ),
    ]
    with caplog.at_level(logging.DEBUG, logger="scorer.report.compile"):
        report = _compile(scores)

    stored = _by_key(report)["pacing-control"]
    assert stored.strengths == []
    assert stored.weaknesses == []
    assert any(
        "delivery-authored" in record.getMessage()
        and "pacing-control" in record.getMessage()
        for record in caplog.records
        if record.levelno == logging.DEBUG
    )


def test_content_authored_lists_survive():
    scores = [
        _score(
            "structured-answers",
            strengths=["Named the metric and the decision it drove."],
            weaknesses=["Answers opened with context instead of the point."],
        ),
        _score("pacing-control"),
    ]
    report = _compile(scores)
    stored = _by_key(report)["structured-answers"]
    assert stored.strengths == ["Named the metric and the decision it drove."]
    assert stored.weaknesses == ["Answers opened with context instead of the point."]


def test_delivery_span_survives_the_list_strip():
    span = "the anchor language for pacing-control"
    scores = [
        _score("structured-answers"),
        _score(
            "pacing-control",
            key_span=span,
            weaknesses=["Long silences before every answer."],
        ),
    ]
    stored = _by_key(_compile(scores))["pacing-control"]
    assert stored.key_span == span
    assert stored.weaknesses == []


def test_delivery_with_empty_lists_is_untouched(caplog):
    with caplog.at_level(logging.DEBUG, logger="scorer.report.compile"):
        report = _compile([_score("structured-answers"), _score("pacing-control")])
    assert _by_key(report)["pacing-control"].strengths == []
    assert not any(
        "delivery-authored" in record.getMessage() for record in caplog.records
    )
