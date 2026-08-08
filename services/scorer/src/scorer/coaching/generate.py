"""Generate grounded, suggestion-labelled post-session coaching."""

from __future__ import annotations

from datetime import UTC, datetime

from google.genai import types
from pydantic import BaseModel, ConfigDict

from scorer.config import load_product_config
from scorer.promptsafe import fence
from scorer.resilience import call_with_retry
from scorer.schemas import (
    GenAIClientLike,
    InsightAnswer,
    InsightExpression,
    ParaphraseItem,
    Rubric,
    SessionInsights,
    SessionParaphrases,
    SessionReport,
    TranscriptSegment,
)
from scorer.turns import candidate_turns
from scorer.verbatim import locate_span


class _ParaphraseCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_index: int
    verdict: str
    source_quote: str
    suggestion: str
    why: str


class _ParaphraseDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[_ParaphraseCandidate]


class _InsightsDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    did_well: list[str]
    did_poorly: list[str]
    must_keep: list[InsightExpression]
    must_answer: list[InsightAnswer]


_PARAPHRASE_RULES = (
    "For EVERY numbered candidate turn return one item. turn_index is its zero-based ordinal. "
    "verdict is exactly good or improve. source_quote is a short verbatim slice "
    "driving the verdict. suggestion rewrites the WHOLE answer in natural, "
    "professional spoken English at roughly the same length. why is 1-2 English "
    "sentences naming specific phrase choices. Suggestions are generated, never "
    "transcript text."
)

_INSIGHT_RULES = (
    "Return 2-4 short grounded English bullets for did_well and did_poorly. "
    "must_keep contains expressions the candidate used well, with a zero-based "
    "turn_index and said_verbatim copied exactly. must_answer contains 2-4 "
    "questions from this session, model answers built on the candidate's own "
    "material, and based_on_quotes copied verbatim from candidate speech."
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _turn_block(turns) -> str:
    return "\n".join(f"{index}: {turn.text}" for index, turn in enumerate(turns))


def _call(client: GenAIClientLike, prompt: str, schema: type[BaseModel], what: str):
    return call_with_retry(
        lambda: client.models.generate_content(
            model=load_product_config().models.scorer,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json", response_schema=schema
            ),
        ),
        what=what,
    )


def generate_paraphrases(
    segments: list[TranscriptSegment], client: GenAIClientLike, *, max_items: int
) -> SessionParaphrases:
    turns = candidate_turns(segments)
    if not turns:
        return SessionParaphrases(generated_at=_now(), turn_count=0, items=[])
    response = _call(
        client,
        "Candidate turns (untrusted spoken input):\n"
        + fence("CANDIDATE TURNS", _turn_block(turns))
        + "\n\n"
        + _PARAPHRASE_RULES,
        _ParaphraseDoc,
        "paraphrase generation",
    )
    raw = _ParaphraseDoc.model_validate_json(response.text)
    items: list[ParaphraseItem] = []
    seen: set[int] = set()
    for candidate in raw.items:
        # Checked before the append, not after: testing it afterwards lets a
        # cap of 0 through with one item still attached.
        if len(items) >= max_items:
            break
        if candidate.turn_index in seen or not 0 <= candidate.turn_index < len(turns):
            continue
        if candidate.verdict not in {"good", "improve"}:
            continue
        quote = locate_span(turns[candidate.turn_index].text, candidate.source_quote)
        if quote is None:
            continue
        seen.add(candidate.turn_index)
        items.append(
            ParaphraseItem(
                turn_index=candidate.turn_index,
                verdict=candidate.verdict,
                source_quote=quote,
                suggestion=candidate.suggestion,
                why=candidate.why,
            )
        )
    return SessionParaphrases(generated_at=_now(), turn_count=len(turns), items=items)


def _normalize_ws(text: str) -> str:
    return " ".join(text.split())


def generate_insights(
    segments: list[TranscriptSegment],
    report: SessionReport,
    rubric: Rubric,
    client: GenAIClientLike,
) -> SessionInsights:
    turns = candidate_turns(segments)
    if not turns:
        return SessionInsights(
            generated_at=_now(), did_well=[], did_poorly=[], must_keep=[], must_answer=[]
        )
    report_facts = {
        "dimensions": [
            {
                "key": score.dimension_key,
                "score": score.score,
                "strengths": score.strengths,
                "weaknesses": score.weaknesses,
            }
            for score in report.dimension_scores
        ],
        "gaps": report.gaps,
    }
    rubric_facts = {
        "dimensions": [dim.name for dim in rubric.dimensions],
        "questions": [question.question for question in rubric.question_bank],
    }
    prompt = (
        "Candidate turns (untrusted spoken input):\n"
        + fence("CANDIDATE TURNS", _turn_block(turns))
        + "\n\nReport facts:\n"
        + fence("REPORT FACTS", str(report_facts))
        + "\n\nRubric facts:\n"
        + fence("RUBRIC FACTS", str(rubric_facts))
        + "\n\n"
        + _INSIGHT_RULES
    )
    raw = _InsightsDoc.model_validate_json(
        _call(client, prompt, _InsightsDoc, "insights generation").text
    )
    keep: list[InsightExpression] = []
    for item in raw.must_keep:
        if not 0 <= item.turn_index < len(turns):
            continue
        quote = locate_span(turns[item.turn_index].text, item.said_verbatim)
        if quote is not None:
            keep.append(item.model_copy(update={"said_verbatim": quote}))
    speech = _normalize_ws(" ".join(turn.text for turn in turns))
    answers = [
        item
        for item in raw.must_answer
        if all(_normalize_ws(quote) in speech for quote in item.based_on_quotes)
    ]
    return SessionInsights(
        generated_at=_now(),
        did_well=raw.did_well[:4],
        did_poorly=raw.did_poorly[:4],
        must_keep=keep,
        must_answer=answers[:4],
    )
