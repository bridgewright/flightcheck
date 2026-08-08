from pathlib import Path


def test_pipeline_hook_is_after_report_and_failure_isolated():
    source = Path("src/scorer/api/pipeline.py").read_text()
    report = source.index("db.save_report(session_id, report)")
    paraphrases = source.index("generate_paraphrases(", report)
    insights = source.index("generate_insights(", paraphrases)
    assert report < paraphrases < insights
    assert 'logger.exception("paraphrase generation failed: session_id=%s"' in source
    assert 'logger.exception("insights generation failed: session_id=%s"' in source


def test_insufficient_returns_before_coaching_generation():
    source = Path("src/scorer/api/pipeline.py").read_text()
    insufficient = source.index('if eligibility == "insufficient"')
    generated = source.index("generate_paraphrases(", insufficient)
    assert source.index("return None", insufficient) < generated


def test_hook_never_writes_marks_or_scoring_stage():
    source = Path("src/scorer/api/pipeline.py").read_text()
    hook = source[source.index("generate_paraphrases(") : source.index("return report")]
    assert "set_paraphrase_mark" not in hook
    assert "set_scoring_stage" not in hook
