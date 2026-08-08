"""F-62: the compiler proves every content dimension against the JD.

The rubric compiler used to accept any dimension the research findings could
license; a 108-character scrape-failed JD once compiled into a rubric whose
top content dimension was licensed entirely by research citations. The
faithfulness contract closes that: every content dimension must carry
jd_evidence resolving (via scorer.verbatim.locate_span) to an exact slice of
the JD as the model saw it -- the neutralized fence body -- at most 300
characters. Faithfulness failures share the single repair retry with
pydantic failures: never more than two generate_content calls per compile.
"""
import json

import pytest

from fakes import FakeGenAI
from scorer.rubric.compiler import RubricCompileError, compile_rubric
from scorer.schemas import CandidateProfile, ResearchFindings, Rubric, SourceCitation

JD_TEXT = "ExampleCorp is hiring a Senior Product Analyst to own growth analytics."

PROFILE = CandidateProfile(
    name=None, headline=None, years_experience=None,
    roles=[], skills=[], achievements=[],
)

FINDINGS = ResearchFindings(
    queries=[], reported_questions=[], probe_areas=[], evaluation_signals=[],
    citations=[SourceCitation(
        url="https://glassdoor.example.com/r1",
        title="Interview review",
        snippet="asked about metrics",
    )],
)


def _dim(key: str, channel: str, weight: float,
         jd_evidence: str | None = None, license_value: str = "jd") -> dict:
    return {
        "key": key,
        "name": key.replace("-", " ").capitalize(),
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": "Vague claims, no example."},
            {"score": 3, "behavior": "One example, thin detail."},
            {"score": 5, "behavior": "Specific and quantified."},
        ],
        "signals": ["named specifics"],
        "citations": [{
            "url": "https://glassdoor.example.com/r1",
            "title": "Interview review",
            "snippet": "asked about metrics",
        }],
        "jd_evidence": jd_evidence,
        "license": license_value,
    }


def _rubric(dimensions: list[dict]) -> dict:
    return {
        "role_title": "Senior Product Analyst",
        "company": "ExampleCorp",
        "dimensions": dimensions,
        "question_bank": [],
        "research_summary": "Synthetic rubric used by faithfulness tests.",
    }


def _good_rubric() -> dict:
    return _rubric([
        _dim("structured-answers", "content", 0.4, "own growth analytics"),
        _dim("role-knowledge", "content", 0.3, "Senior Product Analyst"),
        _dim("pacing-control", "delivery", 0.3),
    ])


def _compile(fake: FakeGenAI, jd_text: str = JD_TEXT) -> Rubric:
    return compile_rubric(jd_text, PROFILE, FINDINGS, [], [], fake)


def _appended(fake: FakeGenAI) -> str:
    """What the repair prompt added after the first prompt."""
    first_prompt = fake.calls[0]["contents"]
    retry_prompt = fake.calls[1]["contents"]
    assert retry_prompt.startswith(first_prompt)
    return retry_prompt[len(first_prompt):]


def test_missing_evidence_retries_once_then_succeeds():
    missing = _rubric([
        _dim("structured-answers", "content", 0.7, None),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(missing), json.dumps(_good_rubric())])
    rubric = _compile(fake)
    assert isinstance(rubric, Rubric)
    assert len(fake.calls) == 2
    appended = _appended(fake)
    assert "PREVIOUS ATTEMPT FAILED VALIDATION" in appended
    # The problem lines follow the header and name the offending dimension.
    header_end = appended.index("PREVIOUS ATTEMPT FAILED VALIDATION")
    problems = appended[header_end:]
    assert '"structured-answers"' in problems
    assert "jd_evidence" in problems


def test_fabricated_evidence_after_retry_raises_at_two_calls():
    fabricated = _rubric([
        _dim("structured-answers", "content", 0.7, "manages a team of forty"),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(fabricated), json.dumps(fabricated)])
    with pytest.raises(RubricCompileError):
        _compile(fake)
    assert len(fake.calls) == 2


def test_whitespace_variant_evidence_stored_as_the_exact_jd_slice():
    variant = _rubric([
        _dim("structured-answers", "content", 0.7, "own\n   growth   analytics"),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(variant)])
    rubric = _compile(fake)
    assert len(fake.calls) == 1
    assert rubric.dimensions[0].jd_evidence == "own growth analytics"


def test_evidence_is_checked_against_the_neutralized_jd():
    # fence() neutralizes ">>>" to single-angle lookalikes before the model
    # ever sees the JD, so evidence quoting the neutralized form resolves
    # and the raw form is a fabrication.
    jd = "Priorities: ship features >>> polish decks. Own growth analytics."
    neutralized = "ship features \u203a\u203a\u203a polish decks"
    raw = "ship features >>> polish decks"

    good = _rubric([
        _dim("structured-answers", "content", 0.7, neutralized),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(good)])
    rubric = _compile(fake, jd_text=jd)
    assert len(fake.calls) == 1
    assert rubric.dimensions[0].jd_evidence == neutralized
    prompt = fake.calls[0]["contents"]
    assert neutralized in prompt
    assert raw not in prompt  # the raw form never appears in jd_as_shown

    bad = _rubric([
        _dim("structured-answers", "content", 0.7, raw),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(bad), json.dumps(good)])
    rubric = _compile(fake, jd_text=jd)
    assert len(fake.calls) == 2
    assert rubric.dimensions[0].jd_evidence == neutralized


def test_resolved_slice_over_300_chars_is_a_problem():
    long_run = "A" * 301
    jd = f"Own the {long_run} platform end to end."
    overlong = _rubric([
        _dim("structured-answers", "content", 0.7, long_run),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fixed = _rubric([
        _dim("structured-answers", "content", 0.7, "platform end to end"),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(overlong), json.dumps(fixed)])
    rubric = _compile(fake, jd_text=jd)
    assert len(fake.calls) == 2
    assert "300" in _appended(fake)
    assert rubric.dimensions[0].jd_evidence == "platform end to end"


def test_delivery_dim_with_fabricated_evidence_is_silently_nulled():
    dims = _rubric([
        _dim("structured-answers", "content", 0.7, "own growth analytics"),
        _dim("pacing-control", "delivery", 0.3, "an invented delivery quote"),
    ])
    fake = FakeGenAI([json.dumps(dims)])
    rubric = _compile(fake)
    assert len(fake.calls) == 1  # harmless output never burns the retry
    assert rubric.dimensions[1].jd_evidence is None


def test_delivery_dim_with_resolvable_evidence_is_silently_resolved():
    dims = _rubric([
        _dim("structured-answers", "content", 0.7, "own growth analytics"),
        _dim("pacing-control", "delivery", 0.3, "Senior\n Product  Analyst"),
    ])
    fake = FakeGenAI([json.dumps(dims)])
    rubric = _compile(fake)
    assert len(fake.calls) == 1
    assert rubric.dimensions[1].jd_evidence == "Senior Product Analyst"


def test_four_delivery_dimensions_are_a_problem():
    # The channel-mislabeling backstop: calling content dimensions
    # "delivery" must not become an escape hatch from the evidence rule.
    four_delivery = _rubric([
        _dim("structured-answers", "content", 0.2, "own growth analytics"),
        _dim("pacing-control", "delivery", 0.2),
        _dim("composure", "delivery", 0.2),
        _dim("spoken-clarity", "delivery", 0.2),
        _dim("warmth", "delivery", 0.2),
    ])
    fake = FakeGenAI([json.dumps(four_delivery), json.dumps(_good_rubric())])
    rubric = _compile(fake)
    assert len(fake.calls) == 2
    assert 'channel "delivery"' in _appended(fake)
    assert isinstance(rubric, Rubric)


def test_pydantic_then_faithfulness_failure_shares_one_retry_budget():
    fabricated = _rubric([
        _dim("structured-answers", "content", 0.7, "manages a team of forty"),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI(["this is not json", json.dumps(fabricated)])
    with pytest.raises(RubricCompileError):
        _compile(fake)
    assert len(fake.calls) == 2


def test_one_profile_licensed_fit_dimension_is_accepted_with_profile():
    with_fit = _rubric([
        _dim("structured-answers", "content", 0.35, "own growth analytics"),
        _dim("role-and-company-fit", "content", 0.1, None, "profile"),
        _dim("role-knowledge", "content", 0.25, "Senior Product Analyst"),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(with_fit)])
    rubric = compile_rubric(JD_TEXT, CandidateProfile(
        name="Alex Example", headline="Management Consultant",
        years_experience="6 years", roles=["Management Consultant"],
        skills=[], achievements=[]), FINDINGS, [], [], fake)
    fit = [dim for dim in rubric.dimensions if dim.license == "profile"]
    assert [dim.key for dim in fit] == ["role-and-company-fit"]
    assert fit[0].jd_evidence is None
    assert len(fake.calls) == 1


def test_profile_licensed_dimension_with_jd_quote_is_a_problem():
    invalid = _rubric([
        _dim("structured-answers", "content", 0.4, "own growth analytics"),
        _dim("role-and-company-fit", "content", 0.1,
             "Senior Product Analyst", "profile"),
        _dim("pacing-control", "delivery", 0.5),
    ])
    fake = FakeGenAI([json.dumps(invalid), json.dumps(_good_rubric())])
    _compile(fake)
    assert "profile-licensed" in _appended(fake)
    assert "jd_evidence null" in _appended(fake)


def test_two_profile_licensed_dimensions_are_a_problem():
    invalid = _rubric([
        _dim("role-and-company-fit", "content", 0.1, None, "profile"),
        _dim("career-fit", "content", 0.1, None, "profile"),
        _dim("structured-answers", "content", 0.4, "own growth analytics"),
        _dim("pacing-control", "delivery", 0.4),
    ])
    fake = FakeGenAI([json.dumps(invalid), json.dumps(_good_rubric())])
    _compile(fake)
    assert "at most one" in _appended(fake)


def test_minimal_profile_cannot_license_a_fit_dimension():
    invalid = _rubric([
        _dim("role-and-company-fit", "content", 0.1, None, "profile"),
        _dim("structured-answers", "content", 0.5, "own growth analytics"),
        _dim("pacing-control", "delivery", 0.4),
    ])
    fake = FakeGenAI([json.dumps(invalid), json.dumps(_good_rubric())])
    rubric = compile_rubric(JD_TEXT, CandidateProfile(
        name=None, headline=None, years_experience=None,
        roles=[], skills=[], achievements=[]), FINDINGS, [], [], fake)
    assert isinstance(rubric, Rubric)
    assert "minimal candidate profile" in _appended(fake)


def test_problem_lines_neutralize_marker_characters_from_the_claim():
    # The claimed quote is model output that can echo marker characters;
    # a problem line lands in an instruction position of the retry prompt,
    # so it must never carry a real fence marker (F-11a hygiene).
    hostile = _rubric([
        _dim("structured-answers", "content", 0.7,
             ">>>invented<<< not in the jd"),
        _dim("pacing-control", "delivery", 0.3),
    ])
    fake = FakeGenAI([json.dumps(hostile), json.dumps(_good_rubric())])
    _compile(fake)
    appended = _appended(fake)
    assert ">>>invented<<<" not in appended
    assert "\u203a\u203a\u203ainvented\u2039\u2039\u2039" in appended
