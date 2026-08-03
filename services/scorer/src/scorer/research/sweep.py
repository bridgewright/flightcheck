"""Per-JD research sweep: grounded search calls, then one structuring call.

Hard-won API fact (W1 bake-off): the google_search tool and response_schema
CANNOT be combined in a single generate_content call. Step 1 runs one
grounded prose call per query and harvests citations from
grounding_metadata. Step 2 structures the concatenated prose with
response_schema (no tools). Grounded citations are authoritative: the
structuring model's citations and queries fields are discarded so it can
never invent a source.
"""
from __future__ import annotations

import json

from google.genai import types

from scorer.config import load_product_config
from scorer.promptsafe import fence
from scorer.resilience import call_with_retry
from scorer.schemas import GenAIClientLike, ResearchFindings, SourceCitation

_SNIPPET_MAX_CHARS = 300     # SourceCitation.snippet contract: <= 300 chars
_JD_EXCERPT_CHARS = 2000

_GROUNDED_PROMPT = (
    "Search the web for first-hand reports about this interview process.\n"
    'Search query to answer: "{query}"\n\n'
    "From what real candidates and interviewers report, list:\n"
    "1. Interview questions candidates say they were actually asked "
    "(verbatim where reported).\n"
    "2. Probe areas: topics interviewers dig deeper into with follow-ups.\n"
    "3. Evaluation signals: what interviewers reward or penalize.\n"
    "Name the source of each item. Report only what sources state; do not "
    "invent.\n\n"
    "Job description context (excerpt):\n{jd_excerpt}"
)

_STRUCTURING_PROMPT = (
    "Structure the research notes below into the requested JSON.\n"
    "Use only facts present in the notes; do not invent questions, probe "
    "areas, or signals.\n"
    "Set the citations field to an empty list and the queries field to an "
    "empty list: authoritative values are attached separately from search "
    "grounding.\n\n"
    "Research notes:\n"
)


def build_queries(role_title: str, company: str | None) -> list[str]:
    """Up to 4 sweep queries; company-scoped ones are skipped when company is None."""
    queries: list[str] = []
    if company is not None:
        queries.append(f"{company} {role_title} interview questions site:glassdoor.com")
        queries.append(f"{company} {role_title} interview experience reddit")
    queries.append(f"{role_title} interview blind teamblind")
    queries.append(f"{role_title} interview what interviewers look for")
    return queries


def _grounding_metadata(response: object) -> types.GroundingMetadata | None:
    """Pull candidates[0].grounding_metadata; None when absent (no grounding)."""
    candidates = getattr(response, "candidates", None)
    if not candidates:
        return None
    return getattr(candidates[0], "grounding_metadata", None)


def _citations_from(metadata: types.GroundingMetadata | None) -> list[SourceCitation]:
    """SourceCitations from one grounded call; support snippets keyed by chunk."""
    if metadata is None:
        return []
    chunks = metadata.grounding_chunks or []
    supports = metadata.grounding_supports or []
    snippet_by_chunk: dict[int, str] = {}
    for support in supports:
        segment = support.segment
        text = segment.text if segment is not None and segment.text else ""
        for index in support.grounding_chunk_indices or []:
            snippet_by_chunk.setdefault(index, text[:_SNIPPET_MAX_CHARS])
    citations: list[SourceCitation] = []
    for index, chunk in enumerate(chunks):
        web = chunk.web
        if web is None or not web.uri:
            continue
        citations.append(SourceCitation(
            url=web.uri,
            title=web.title or web.uri,
            snippet=snippet_by_chunk.get(index, ""),
        ))
    return citations


def _dedupe_by_url(citations: list[SourceCitation]) -> list[SourceCitation]:
    """Order-preserving dedupe; the first sighting of a url wins."""
    seen: set[str] = set()
    unique: list[SourceCitation] = []
    for citation in citations:
        if citation.url in seen:
            continue
        seen.add(citation.url)
        unique.append(citation)
    return unique


def run_sweep(jd_text: str, role_title: str, company: str | None,
              client: GenAIClientLike) -> ResearchFindings:
    """Two-step grounded sweep -> ResearchFindings with authoritative citations."""
    product = load_product_config()
    queries = build_queries(role_title, company)
    prose_blocks: list[str] = []
    grounded_citations: list[SourceCitation] = []
    for index, query in enumerate(queries):
        # F-11a: the JD excerpt is user text — fenced as data.
        prompt = _GROUNDED_PROMPT.format(
            query=query,
            jd_excerpt=fence("JOB DESCRIPTION EXCERPT",
                             jd_text[:_JD_EXCERPT_CHARS]))
        response = call_with_retry(
            lambda: client.models.generate_content(
                model=product.models.scorer,
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                ),
            ),
            what=f"research sweep query {index + 1}",
        )
        prose_blocks.append(f'## Query: "{query}"\n{response.text or ""}')
        grounded_citations.extend(
            _citations_from(_grounding_metadata(response)))
    structured = call_with_retry(
        lambda: client.models.generate_content(
            model=product.models.scorer,
            contents=_STRUCTURING_PROMPT + "\n\n".join(prose_blocks),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ResearchFindings,
            ),
        ),
        what="research structuring",
    )
    parsed = ResearchFindings.model_validate(json.loads(structured.text))
    # Rebuild rather than mutate: queries and citations come from step 1
    # (authoritative), never from the structuring model's output.
    return ResearchFindings(
        queries=queries,
        reported_questions=parsed.reported_questions,
        probe_areas=parsed.probe_areas,
        evaluation_signals=parsed.evaluation_signals,
        citations=_dedupe_by_url(grounded_citations),
    )
