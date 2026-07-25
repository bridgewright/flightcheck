"""Evals layer 1: golden triplets, blind-rank sheets, and judge discrimination.

Suite layout under evals/suites/rubric_discrimination/:
  triplets/<dimension_key>-<n>.json     TripletDoc (question + strong/borderline/weak)
  manual/<dimension_key>-<n>.yaml       blind sheet (answers shuffled to labels A/B/C)
  manual/keys/<dimension_key>-<n>.yaml  answer key (label -> variant), a separate file
                                        so a human ranker never sees the truth

The judge scores each answer with the product content judge (score_content) and
checks the strict ordering strong > borderline > weak per triplet.
"""
from __future__ import annotations

import json
import os

import httpx
from pydantic import BaseModel, ConfigDict

from scorer.config import load_product_config
from scorer.schemas import Rubric, RubricDimension

# Generator vendor (OpenAI) != judge vendor (Gemini): an LLM judge tends to prefer
# its own vendor's text (self-preference), which would inflate measured accuracy.

_OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
_VARIANTS = ("strong", "borderline", "weak")
_LETTERS = ("A", "B", "C")


class TripletGenerationError(Exception):
    """The generator call could not produce a usable triplet."""


class TripletDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dimension_key: str
    question: str
    strong: str
    borderline: str
    weak: str


def _question_for(rubric: Rubric, dimension: RubricDimension) -> str:
    for spec in rubric.question_bank:
        if spec.dimension_key == dimension.key:
            return spec.question
    raise TripletGenerationError(
        f"no question in rubric question_bank for dimension {dimension.key!r}"
    )


def _generation_prompt(question: str, dimension: RubricDimension) -> str:
    anchors = {anchor.score: anchor.behavior for anchor in dimension.anchors}
    return (
        "You write synthetic candidate answers for an interview-scoring calibration set.\n"
        f"Interview question: {question}\n"
        f"Dimension under test: {dimension.name}\n\n"
        "Write three different answers to this one question:\n"
        f'- "strong" exhibits the score-5 behavior: {anchors[5]}\n'
        f'- "borderline" exhibits the score-3 behavior: {anchors[3]}\n'
        f'- "weak" exhibits the score-1 behavior: {anchors[1]}\n\n'
        "Rules: each answer is 120-200 words, first-person spoken interview style,\n"
        "no meta-commentary, no labels or headings inside the answers. The three\n"
        "answers must differ only in how well they exhibit the target behavior.\n"
        'Reply with JSON only: {"strong": "...", "borderline": "...", "weak": "..."}'
    )


def generate_triplet(
    rubric: Rubric, dimension: RubricDimension, client_openai: httpx.Client
) -> TripletDoc:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        raise TripletGenerationError("OPENAI_API_KEY not set")
    question = _question_for(rubric, dimension)
    response = client_openai.post(
        _OPENAI_CHAT_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": load_product_config().models.triplet_generator,
            "messages": [{"role": "user", "content": _generation_prompt(question, dimension)}],
            "response_format": {"type": "json_object"},
        },
        timeout=120.0,
    )
    response.raise_for_status()
    try:
        payload = json.loads(response.json()["choices"][0]["message"]["content"])
        return TripletDoc(
            dimension_key=dimension.key,
            question=question,
            strong=payload["strong"],
            borderline=payload["borderline"],
            weak=payload["weak"],
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise TripletGenerationError(f"unusable generator reply: {exc}") from exc
