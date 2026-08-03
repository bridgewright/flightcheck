"""Rubric compiler: one structured call over JD + profile + research + corpus.

The prompt assembles the JD text, a candidate profile summary, the research
sweep findings (its citation list is the only web-source pool the model may
cite), private corpus excerpts (citable as corpus://<doc_id>), and up to two
few-shot example rubrics. One generate_content call structures the response
as a Rubric; pydantic validation on the Rubric model is the gate of record
(citation-less dimensions, bad weights, and broken anchor triples are all
rejected there). On a ValidationError the compiler retries exactly once,
appending the validation error text so the model can repair its output; a
second failure raises RubricCompileError.
"""
from __future__ import annotations

from google.genai import types
from pydantic import ValidationError

from scorer.config import load_product_config
from scorer.promptsafe import fence
from scorer.resilience import call_with_retry
from scorer.rubric.corpus import CorpusDoc
from scorer.schemas import CandidateProfile, GenAIClientLike, ResearchFindings, Rubric

_CORPUS_EXCERPT_CHARS = 2000
_MAX_FEWSHOTS = 2


class RubricCompileError(Exception):
    """The model failed to produce a valid Rubric (validation retry exhausted)."""


_RULES = (
    "## STRICT RULES\n"
    "- Produce 5 to 8 dimensions, each with a unique kebab-case key.\n"
    '- At least one dimension must have channel "delivery" (how the candidate sounds:\n'
    '  pacing, composure, spoken clarity). The rest are channel "content".\n'
    "- Every dimension must cite at least one source. Use either a research citation url\n"
    "  from the findings above, copied verbatim, or a corpus document cited with url\n"
    '  "corpus://<doc_id>" and the document title.\n'
    "- Weights must sum to 1.0 across all dimensions.\n"
    "- Give every dimension exactly three BARS anchors, for scores 1, 3, and 5. Each anchor\n"
    "  is a behavioral statement describing observable answer behavior, question-independent\n"
    "  (it must apply to any question probing that dimension).\n"
    "- Build question_bank preferentially from the reported questions in the findings;\n"
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
    "Your previous rubric was rejected by schema validation with the errors below.\n"
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


def compile_rubric(jd_text: str, profile: CandidateProfile, findings: ResearchFindings,
                   corpus: list[CorpusDoc], fewshots: list[Rubric],
                   client: GenAIClientLike) -> Rubric:
    """One structured call -> validated Rubric; one repair retry on ValidationError."""
    product = load_product_config()
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=Rubric,
    )
    # F-11a: the JD is truncated to a config length before it ever reaches
    # the prompt — an unbounded JD is both spend and injection surface.
    jd_text = jd_text[:product.limits.jd_compile_max_chars]
    prompt = _build_prompt(jd_text, profile, findings, corpus, fewshots)
    response = call_with_retry(
        lambda: client.models.generate_content(
            model=product.models.scorer, contents=prompt, config=config),
        what="rubric compile",
    )
    try:
        return Rubric.model_validate_json(response.text or "")
    except ValidationError as first_error:
        retry_prompt = f"{prompt}\n\n{_RETRY_HEADER}{first_error}"
        retry_response = call_with_retry(
            lambda: client.models.generate_content(
                model=product.models.scorer, contents=retry_prompt,
                config=config),
            what="rubric compile repair",
        )
        try:
            return Rubric.model_validate_json(retry_response.text or "")
        except ValidationError as second_error:
            raise RubricCompileError(
                f"rubric failed validation after one retry: {second_error}"
            ) from second_error
