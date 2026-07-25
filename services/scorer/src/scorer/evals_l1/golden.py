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

import argparse
import json
import os
import random
from pathlib import Path

import httpx
import yaml
from pydantic import BaseModel, ConfigDict

from scorer.config import load_product_config
from scorer.content.judge import ContentJudgeError, score_content
from scorer.env import load_env, require_key
from scorer.schemas import GenAIClientLike, Rubric, RubricDimension, TranscriptSegment

# Generator vendor (OpenAI) != judge vendor (Gemini): an LLM judge tends to prefer
# its own vendor's text (self-preference), which would inflate measured accuracy.

# src/scorer/evals_l1/golden.py -> repo root (same arithmetic as scorer.bakeoff).
REPO_ROOT = Path(__file__).resolve().parents[4].parent
SUITE_DIR = REPO_ROOT / "evals" / "suites" / "rubric_discrimination"
OUT_PATH = REPO_ROOT / "evals" / "out" / "rubric_discrimination.json"
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


def _write_sheet_and_key(doc: TripletDoc, n: int, manual_dir: Path) -> None:
    # Seeded by sheet identity: re-running the generator never silently reshuffles
    # a sheet a human may already have ranked.
    rng = random.Random(f"{doc.dimension_key}-{n}")
    order = list(_VARIANTS)
    rng.shuffle(order)
    sheet = {
        "dimension": doc.dimension_key,
        "question": doc.question,
        "answers": {
            letter: getattr(doc, variant)
            for letter, variant in zip(_LETTERS, order, strict=True)
        },
        "ranking": [],
        "notes": "",
    }
    key = {
        "dimension": doc.dimension_key,
        "key": dict(zip(_LETTERS, order, strict=True)),
    }
    keys_dir = manual_dir / "keys"
    keys_dir.mkdir(parents=True, exist_ok=True)
    sheet_path = manual_dir / f"{doc.dimension_key}-{n}.yaml"
    sheet_path.write_text(yaml.safe_dump(sheet, sort_keys=False, allow_unicode=True))
    key_path = keys_dir / f"{doc.dimension_key}-{n}.yaml"
    key_path.write_text(yaml.safe_dump(key, sort_keys=False, allow_unicode=True))


def generate_goldens(
    rubric_path: Path,
    out_dir: Path,
    top_n_dims: int = 3,
    sets_per_dim: int = 1,
    client_openai: httpx.Client | None = None,
) -> list[Path]:
    rubric = Rubric.model_validate_json(Path(rubric_path).read_text())
    # Stable sort: equal weights keep rubric order. Content channel only —
    # delivery dimensions are exercised by evals layer 3, not by text triplets.
    content_dims = sorted(
        (d for d in rubric.dimensions if d.channel == "content"),
        key=lambda d: d.weight,
        reverse=True,
    )[:top_n_dims]
    owns_client = client_openai is None
    client = httpx.Client() if owns_client else client_openai
    triplets_dir = Path(out_dir) / "triplets"
    triplets_dir.mkdir(parents=True, exist_ok=True)
    manual_dir = Path(out_dir) / "manual"
    written: list[Path] = []
    try:
        for dimension in content_dims:
            for n in range(1, sets_per_dim + 1):
                doc = generate_triplet(rubric, dimension, client)
                triplet_path = triplets_dir / f"{dimension.key}-{n}.json"
                triplet_path.write_text(doc.model_dump_json(indent=2))
                _write_sheet_and_key(doc, n, manual_dir)
                written.append(triplet_path)
    finally:
        if owns_client:
            client.close()
    return written


def _answer_segments(question: str, answer: str) -> list[TranscriptSegment]:
    # Exactly one fabricated candidate segment carries the written answer; the
    # interviewer segment provides question context. Timestamps are nominal --
    # the content judge reads text, not timing.
    return [
        TranscriptSegment(start_s=0.0, end_s=5.0, speaker="interviewer", text=question),
        TranscriptSegment(start_s=5.5, end_s=90.0, speaker="candidate", text=answer),
    ]


def judge_discrimination(
    triplets_dir: Path, rubric: Rubric, client: GenAIClientLike
) -> dict:
    triplet_paths = sorted(Path(triplets_dir).glob("*.json"))
    trials = 0
    correct = 0
    failures: list[dict] = []
    for path in triplet_paths:
        doc = TripletDoc.model_validate_json(path.read_text())
        trials += 1
        scores: dict[str, float] = {}
        error: str | None = None
        for variant in _VARIANTS:  # documented order: strong, borderline, weak
            segments = _answer_segments(doc.question, getattr(doc, variant))
            try:
                dimension_scores = score_content(rubric, segments, client)
            except ContentJudgeError as exc:
                # One unusable judge reply is a data point, not the end of the
                # run (bake-off house rule); the cause is recorded, not hidden.
                error = f"{type(exc).__name__}: {str(exc)[:120]}"
                break
            matched = next(
                (s for s in dimension_scores if s.dimension_key == doc.dimension_key), None
            )
            if matched is None:
                error = f"dimension {doc.dimension_key!r} missing from judge output"
                break
            scores[variant] = matched.score
        if error is not None:
            failures.append({"triplet": path.stem, "scores": scores, "reason": error})
            continue
        if scores["strong"] > scores["borderline"] > scores["weak"]:
            correct += 1
        else:
            failures.append({
                "triplet": path.stem,
                "scores": scores,
                "reason": "scores not strictly ordered strong > borderline > weak",
            })
    accuracy = correct / trials if trials else 0.0
    return {"trials": trials, "correct": correct, "accuracy": accuracy, "failures": failures}


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="scorer-evals-l1",
        description="Generate golden triplets / judge rubric discrimination (evals layer 1).",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("generate", help="generate triplets and blind-rank sheets")
    gen.add_argument("--rubric", type=Path, required=True, help="path to a Rubric JSON file")
    gen.add_argument("--out-dir", type=Path, default=SUITE_DIR)
    gen.add_argument("--top-n-dims", type=int, default=3)
    gen.add_argument("--sets-per-dim", type=int, default=1)
    judge = sub.add_parser("judge", help="score triplets with the content judge")
    judge.add_argument("--rubric", type=Path, required=True, help="path to a Rubric JSON file")
    judge.add_argument("--triplets-dir", type=Path, default=SUITE_DIR / "triplets")
    judge.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()

    load_env()
    if args.command == "generate":
        require_key("OPENAI_API_KEY")
        written = generate_goldens(
            args.rubric, args.out_dir, args.top_n_dims, args.sets_per_dim
        )
        print(f"wrote {len(written)} triplet(s) under {args.out_dir}")
        return
    from google import genai  # deferred import: only the judge path needs a client

    client = genai.Client(api_key=require_key("GEMINI_API_KEY"))
    rubric = Rubric.model_validate_json(args.rubric.read_text())
    result = judge_discrimination(args.triplets_dir, rubric, client)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2))
    summary = {k: result[k] for k in ("trials", "correct", "accuracy")}
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
