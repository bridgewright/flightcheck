"""Rubric compiler: one structured call over JD + profile + research + corpus.

The prompt assembles the JD text, a candidate profile summary, the research
sweep findings (its citation list is the only web-source pool the model may
cite), private corpus excerpts (citable as corpus://<doc_id>), and up to two
few-shot example rubrics. One generate_content call structures the response
as a Rubric. Two gates run on every response: pydantic validation on the
Rubric model (citation-less dimensions, bad weights, and broken anchor
triples are all rejected there), then the F-62 faithfulness check -- every
content dimension must carry jd_evidence resolving to an exact slice of the
JD as the model saw it, so research findings and corpus documents can
corroborate a dimension but never create one. Both kinds of failure share a
single repair retry: the failure text is appended so the model can repair
its output, and a second failure of either kind raises RubricCompileError.
Never more than two generate_content calls per compile.
"""
from __future__ import annotations

from google.genai import types
from pydantic import ValidationError

from scorer.config import load_product_config
from scorer.promptsafe import fence, inline, neutralize_markers
from scorer.resilience import call_with_retry
from scorer.rubric.corpus import CorpusDoc
from scorer.schemas import CandidateProfile, GenAIClientLike, ResearchFindings, Rubric
from scorer.verbatim import locate_span

_CORPUS_EXCERPT_CHARS = 2000
_MAX_FEWSHOTS = 2
# Mirrors SourceCitation.snippet's cap. Deliberately NOT product.toml: this
# bound is calibrated against evals/suites/rubric_faithfulness, and moving
# it without re-running that suite would change the product's faithfulness
# claim with no evidence behind it.
_JD_EVIDENCE_MAX_CHARS = 300
# The channel-mislabeling backstop: relabeling content dimensions as
# "delivery" must not become an escape hatch from the evidence rule, so the
# cap the prompt states (one to three) is enforced here too.
_MAX_DELIVERY_DIMS = 3


class RubricCompileError(Exception):
    """The model failed to produce a valid Rubric (validation retry exhausted)."""


_RULES = (
    "## STRICT RULES\n"
    "- Produce 5 to 8 dimensions, each with a unique kebab-case key.\n"
    '- One to three dimensions must have channel "delivery" (how the candidate sounds:\n'
    '  pacing, composure, spoken clarity). The rest are channel "content".\n'
    '- Every channel "content" dimension must carry jd_evidence: a short quote copied\n'
    "  character for character from the JOB DESCRIPTION block above, at most 300\n"
    "  characters, proving the ROLE itself demands that dimension -- its\n"
    "  responsibilities, requirements, or day-to-day language. If no such line\n"
    "  exists, the dimension does not belong in this rubric.\n"
    '- A company-values or mission statement never licenses a dimension. "We value\n'
    '  integrity" is decoration; "own incident response for enterprise customers" is\n'
    "  a requirement. Quote requirements, not values.\n"
    "- Research findings and corpus documents corroborate dimensions; they cannot\n"
    "  create one. A topic that appears only in the research, however often, gets no\n"
    "  dimension unless the job description itself calls for it.\n"
    '- When the CANDIDATE PROFILE has roles or a headline, add exactly one content\n'
    '  dimension keyed "role-and-company-fit", named "Role & company fit", with\n'
    '  license "profile", jd_evidence null, and a modest weight around 0.08 to 0.12.\n'
    "  It covers motivation for this company and role and the candidate's career\n"
    "  story. With a minimal profile, add no such dimension and use only the\n"
    '  default "jd" license.\n'
    "- Delivery dimensions need no jd_evidence -- set it to null there.\n"
    "- Weights follow the job description's own emphasis: what it leads with and\n"
    "  repeats carries the most weight, what it mentions in passing the least.\n"
    "- The example rubrics below may predate jd_evidence and show null on content\n"
    "  dimensions. That is their age, not a license -- your content dimensions must\n"
    "  carry it.\n"
    "- Every dimension must cite at least one source. Use either a research citation url\n"
    "  from the findings above, copied verbatim, or a corpus document cited with url\n"
    '  "corpus://<doc_id>" and the document title.\n'
    "- Weights must sum to 1.0 across all dimensions.\n"
    "- Give every dimension exactly three BARS anchors, for scores 1, 3, and 5. Each anchor\n"
    "  is a behavioral statement describing observable answer behavior, question-independent\n"
    "  (it must apply to any question probing that dimension).\n"
    "- Build question_bank preferentially from the reported questions in the findings;\n"
    "- Provide 2 to 4 question_bank entries per dimension, content and delivery alike,\n"
    "  each a genuinely different angle -- the interview runs up to six sessions and\n"
    "  must not repeat itself.\n"
    '  mark those source "research-sweep". Questions adapted from corpus docs are source\n'
    '  "corpus"; questions you write yourself are source "generated".\n'
    "- Set role_title (and company, when the job description names one) from the job\n"
    "  description.\n"
    "- Write research_summary as 3-6 sentences on what the research says this interview\n"
    "  rewards and penalizes.\n"
    "Return only JSON matching the response schema."
)

_RETRY_HEADER = (
    "## PREVIOUS ATTEMPT FAILED VALIDATION\n"
    "Your previous rubric was rejected by validation with the problems below.\n"
    "Fix every error and return the full corrected rubric JSON.\n"
)


def _profile_block(profile: CandidateProfile) -> str:
    roles = "; ".join(profile.roles) or "not stated"
    skills = ", ".join(profile.skills) or "not stated"
    achievements = "; ".join(profile.achievements) or "not stated"
    return (
        f"Name: {profile.name or 'not stated'}\n"
        f"Headline: {profile.headline or 'not stated'}\n"
        f"Experience: {profile.years_experience or 'not stated'}\n"
        f"Roles (most recent first): {roles}\n"
        f"Skills: {skills}\n"
        f"Achievements: {achievements}"
    )


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items) or "- none reported"


def _findings_block(findings: ResearchFindings) -> str:
    citations = "\n".join(
        f"- {c.url} | {c.title} | {c.snippet}" for c in findings.citations
    ) or "- none"
    return (
        "Questions real candidates reported being asked:\n"
        f"{_bullets(findings.reported_questions)}\n"
        "Probe areas interviewers dig into:\n"
        f"{_bullets(findings.probe_areas)}\n"
        "Evaluation signals interviewers reward or penalize:\n"
        f"{_bullets(findings.evaluation_signals)}\n"
        "Research citations (the only web sources you may cite, urls verbatim):\n"
        f"{citations}"
    )


def _corpus_block(corpus: list[CorpusDoc]) -> str:
    if not corpus:
        return "(no corpus documents provided)"
    return "\n\n".join(
        f"### corpus://{doc.doc_id} | {doc.title}\n{doc.text[:_CORPUS_EXCERPT_CHARS]}"
        for doc in corpus
    )


def _fewshot_block(fewshots: list[Rubric]) -> str:
    if not fewshots:
        return "(no example rubrics provided)"
    return "\n\n".join(
        f"### Example rubric {index + 1}\n{example.model_dump_json()}"
        for index, example in enumerate(fewshots[:_MAX_FEWSHOTS])
    )


def _build_prompt(jd_text: str, profile: CandidateProfile, findings: ResearchFindings,
                  corpus: list[CorpusDoc], fewshots: list[Rubric]) -> str:
    return (
        "You are compiling a behaviorally-anchored scoring rubric (BARS) for a mock\n"
        "interview coach. Ground every dimension in the sources below.\n\n"
        # F-11a: JD and profile are user-supplied — fenced as data so a JD
        # that ships its own "## STRICT RULES" block cannot outrank ours.
        f"## JOB DESCRIPTION\n{fence('JOB DESCRIPTION', jd_text)}\n\n"
        f"## CANDIDATE PROFILE\n"
        f"{fence('CANDIDATE PROFILE', _profile_block(profile))}\n\n"
        f"## RESEARCH FINDINGS\n{_findings_block(findings)}\n\n"
        f"## CORPUS EXCERPTS\n{_corpus_block(corpus)}\n\n"
        "## EXAMPLE RUBRICS (format references; do not copy their content)\n"
        f"{_fewshot_block(fewshots)}\n\n"
        f"{_RULES}"
    )


def _check_faithfulness(
    rubric: Rubric,
    jd_as_shown: str,
    profile_non_minimal: bool,
) -> tuple[Rubric, list[str]]:
    """Enforce the jd_evidence contract against the JD as the model saw it.

    Content dimensions: jd_evidence must resolve (scorer.verbatim.locate_span)
    to an exact slice of `jd_as_shown` no longer than _JD_EVIDENCE_MAX_CHARS.
    A whitespace-variant claim is rewritten onto the dimension as the exact
    character-for-character slice; a missing, fabricated, or overlong claim
    is a problem for the shared repair retry. Delivery dimensions never need
    evidence, so a value there is resolved-or-nulled silently -- harmless
    output must not burn the retry. More than _MAX_DELIVERY_DIMS delivery
    dimensions is a problem (the channel-mislabeling backstop).

    Problem lines land in an instruction position of the retry prompt, and a
    claimed quote can echo JD text and marker characters, so claims are
    embedded via promptsafe.inline (F-11a hygiene).
    """
    problems: list[str] = []
    dimensions = []
    changed = False
    for dim in rubric.dimensions:
        if dim.license == "profile":
            if dim.key != "role-and-company-fit" or dim.channel != "content":
                problems.append(
                    f'dimension "{dim.key}": only the role-and-company-fit '
                    "CONTENT dimension may be profile-licensed (wrong key, "
                    "wrong channel, or both)"
                )
            if dim.jd_evidence is not None:
                problems.append(
                    f'dimension "{dim.key}": a profile-licensed dimension must '
                    "carry jd_evidence null"
                )
            dimensions.append(dim)
            continue
        located = locate_span(jd_as_shown, dim.jd_evidence)
        if dim.channel == "content":
            if located is None:
                problems.append(
                    f'dimension "{dim.key}": jd_evidence '
                    f'"{inline(dim.jd_evidence, 320)}" is not an exact quote '
                    "from the JOB DESCRIPTION block; copy a short span "
                    "character for character, or drop the dimension"
                )
            elif len(located) > _JD_EVIDENCE_MAX_CHARS:
                problems.append(
                    f'dimension "{dim.key}": jd_evidence '
                    f'"{inline(dim.jd_evidence, 320)}" resolves to '
                    f"{len(located)} characters of the job description; "
                    f"quote at most {_JD_EVIDENCE_MAX_CHARS}"
                )
            elif located != dim.jd_evidence:
                dim = dim.model_copy(update={"jd_evidence": located})
                changed = True
        elif dim.jd_evidence is not None and located != dim.jd_evidence:
            dim = dim.model_copy(update={"jd_evidence": located})
            changed = True
        dimensions.append(dim)
    profile_dims = [dim for dim in rubric.dimensions if dim.license == "profile"]
    if len(profile_dims) > 1:
        problems.append(
            f"rubric has {len(profile_dims)} profile-licensed dimensions; at most one "
            "is allowed"
        )
    if profile_dims and not profile_non_minimal:
        problems.append(
            "a minimal candidate profile cannot license a profile dimension"
        )
    delivery_count = sum(
        1 for dim in rubric.dimensions if dim.channel == "delivery")
    if delivery_count > _MAX_DELIVERY_DIMS:
        problems.append(
            f'rubric has {delivery_count} channel "delivery" dimensions; at '
            f"most {_MAX_DELIVERY_DIMS} are allowed, and every other "
            "dimension is content and needs jd_evidence"
        )
    if changed:
        rubric = rubric.model_copy(update={"dimensions": dimensions})
    return rubric, problems


def compile_rubric(jd_text: str, profile: CandidateProfile, findings: ResearchFindings,
                   corpus: list[CorpusDoc], fewshots: list[Rubric],
                   client: GenAIClientLike) -> Rubric:
    """One structured call -> validated, JD-faithful Rubric.

    Pydantic and faithfulness failures share one repair retry: at most two
    generate_content calls, then RubricCompileError.
    """
    product = load_product_config()
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=Rubric,
    )
    # F-11a: the JD is truncated to a config length before it ever reaches
    # the prompt — an unbounded JD is both spend and injection surface.
    jd_text = jd_text[:product.limits.jd_compile_max_chars]
    # Exactly the string fence() puts between the markers: jd_evidence is
    # checked against the JD as the model saw it, never the raw input.
    jd_as_shown = neutralize_markers(jd_text)
    prompt = _build_prompt(jd_text, profile, findings, corpus, fewshots)

    def _attempt(contents: str, what: str) -> tuple[Rubric | None, str]:
        response = call_with_retry(
            lambda: client.models.generate_content(
                model=product.models.scorer, contents=contents, config=config),
            what=what,
        )
        try:
            rubric = Rubric.model_validate_json(response.text or "")
        except ValidationError as error:
            return None, str(error)
        rubric, problems = _check_faithfulness(
            rubric, jd_as_shown, bool(profile.roles or profile.headline))
        if problems:
            return None, "\n".join(f"- {problem}" for problem in problems)
        return rubric, ""

    rubric, error_text = _attempt(prompt, "rubric compile")
    if rubric is not None:
        return rubric
    # The repair prompt appends the problems, never the failed response
    # (pinned by test_invalid_first_response_retries_once_with_error_text).
    rubric, error_text = _attempt(
        f"{prompt}\n\n{_RETRY_HEADER}{error_text}", "rubric compile repair")
    if rubric is not None:
        return rubric
    raise RubricCompileError(
        f"rubric failed validation after one retry: {error_text}")
