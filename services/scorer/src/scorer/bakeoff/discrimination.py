from __future__ import annotations

import base64
import itertools
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

TRUTH = ["fluent", "filler", "hesitant"]  # best → worst delivery
PROMPT = (
    "You will hear three recordings (A, B, C) of a candidate answering the same interview "
    "question in English. Rank them from strongest to weakest INTERVIEW DELIVERY — confidence, "
    "fluency, absence of fillers and hesitation. Judge delivery only, not content. "
    'Reply with JSON only: {"ranking": ["X", "Y", "Z"]}'
)


class AudioRanker(Protocol):
    name: str
    def rank(self, labeled: list[tuple[str, Path]], prompt: str) -> list[str]: ...


class RankerAPIError(Exception):
    """The provider call itself failed (network, auth, bad request, ...).
    Raised with `from exc` so the original exception survives as `__cause__`."""


class RankerParseError(Exception):
    """The provider call succeeded but the reply couldn't be turned into a
    ranking. Raised with `from exc` so the original exception survives as
    `__cause__`."""


_JSON_OBJECT_RE = re.compile(r"\{.*?\}", re.DOTALL)
_FENCE_RE = re.compile(r"^```[a-zA-Z0-9]*\s*\n?|\n?```\s*$")


def parse_ranking_reply(text: str) -> list[str]:
    """Turn a model's free-text reply into a ranking list.

    Strips a wrapping markdown code fence if present, then extracts the first
    `{...}` JSON object via regex before handing it to `json.loads` — some
    models (e.g. gpt-audio, which rejects `response_format=json_object`)
    answer with prose or a fenced block around the JSON rather than a bare
    object.
    """
    cleaned = _FENCE_RE.sub("", (text or "").strip()).strip()
    match = _JSON_OBJECT_RE.search(cleaned)
    if not match:
        raise ValueError(f"no JSON object found in reply: {cleaned[:200]!r}")
    return json.loads(match.group(0))["ranking"]


def _failure_detail(exc: BaseException) -> str:
    """Short `ExceptionClass: message[:120]` string for the *original* failure
    — unwraps `RankerAPIError`/`RankerParseError` back to their `__cause__` so
    the real exception class and message are never hidden behind a wrapper."""
    origin = exc.__cause__ or exc
    return f"{type(origin).__name__}: {str(origin)[:120]}"


@dataclass
class Trial:
    model: str
    permutation: tuple
    predicted: list[str]
    correct: bool


def rank_clips(ranker: AudioRanker, clips: dict[str, Path],
               permutation: tuple[str, ...] = ("fluent", "filler", "hesitant")) -> Trial:
    letters = ["A", "B", "C"]
    labeled = [(letters[i], clips[k]) for i, k in enumerate(permutation)]
    predicted = ranker.rank(labeled, PROMPT)
    letter_of = {k: letters[i] for i, k in enumerate(permutation)}
    expected = [letter_of[k] for k in TRUTH]
    return Trial(ranker.name, permutation, predicted, predicted == expected)


def accuracy(trials: list[Trial]) -> float:
    """Share of parsed trials ranked exactly right. API and parse failures are
    counted separately (`run_trials`) and stay out of this denominator."""
    return sum(t.correct for t in trials) / len(trials) if trials else 0.0


def find_question_dirs(base: Path) -> list[Path]:
    """Question dirs (`clips/q*`), or a friendly exit — never an empty run."""
    qdirs = sorted(p for p in (base / "clips").glob("q*") if p.is_dir())
    if not qdirs:
        raise SystemExit(f"no question dirs in {base / 'clips'} — see manual_protocol.md")
    return qdirs


def run_trials(ranker: AudioRanker,
                qdirs: list[Path]) -> tuple[list[Trial], int, int, list[str]]:
    """All permutations for every question. One unusable reply is a data point,
    not the end of the run — it is counted and the sweep continues.

    Failures are split by where they happened: `api_failures` are exceptions
    raised while calling the provider (network, auth, a rejected request, ...);
    `parse_failures` are replies the API returned successfully but this code
    could not turn into a ranking. `failure_details` holds one short
    `ExceptionClass: message[:120]` string per failure, in call order, so a
    cause is never silently hidden behind a bare count again.
    """
    trials: list[Trial] = []
    api_failures = 0
    parse_failures = 0
    failure_details: list[str] = []
    for qdir in qdirs:
        clips = {k: qdir / f"{k}.wav" for k in TRUTH}
        if not all(p.exists() for p in clips.values()):
            raise SystemExit(f"missing clips in {qdir} — see manual_protocol.md")
        for perm in itertools.permutations(TRUTH):
            try:
                trials.append(rank_clips(ranker, clips, perm))
            except RankerParseError as exc:
                parse_failures += 1
                failure_details.append(_failure_detail(exc))
                print(f"  parse failure [{ranker.name} {qdir.name} {'/'.join(perm)}]: {exc!r}")
            except Exception as exc:  # noqa: BLE001 — any other failure is one trial lost, no more
                api_failures += 1
                failure_details.append(_failure_detail(exc))
                print(f"  api failure [{ranker.name} {qdir.name} {'/'.join(perm)}]: {exc!r}")
    return trials, api_failures, parse_failures, failure_details


class OpenAIRanker:
    def __init__(self, model: str):
        from openai import OpenAI
        self.name = f"openai/{model}"
        self.model = model
        self.client = OpenAI()

    def rank(self, labeled, prompt):
        content = [{"type": "text", "text": prompt}]
        for letter, path in labeled:
            content.append({"type": "text", "text": f"Recording {letter}:"})
            content.append({"type": "input_audio", "input_audio": {
                "data": base64.b64encode(Path(path).read_bytes()).decode(), "format": "wav"}})
        # gpt-audio (and other audio-capable chat models) 400 on
        # response_format={"type": "json_object"}: "not supported with this
        # model". No strict JSON mode here — parse_ranking_reply handles
        # fenced/prose replies instead. Gemini side still asks via
        # response_mime_type, which that API does support.
        try:
            r = self.client.chat.completions.create(
                model=self.model, messages=[{"role": "user", "content": content}])
        except Exception as exc:
            raise RankerAPIError(str(exc)) from exc
        try:
            return parse_ranking_reply(r.choices[0].message.content)
        except Exception as exc:
            raise RankerParseError(str(exc)) from exc


class GeminiRanker:
    def __init__(self, model: str):
        from google import genai
        self.name = f"gemini/{model}"
        self.model = model
        self.client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))

    def rank(self, labeled, prompt):
        from google.genai import types
        parts = [prompt]
        for letter, path in labeled:
            parts.append(f"Recording {letter}:")
            parts.append(types.Part.from_bytes(data=Path(path).read_bytes(), mime_type="audio/wav"))
        try:
            r = self.client.models.generate_content(
                model=self.model, contents=parts,
                config={"response_mime_type": "application/json"})
        except Exception as exc:
            raise RankerAPIError(str(exc)) from exc
        try:
            return json.loads(r.text)["ranking"]
        except Exception as exc:
            raise RankerParseError(str(exc)) from exc


def main() -> None:
    from ..env import load_env, require_key
    from ..realtime_probe.openai_probe import load_bakeoff_config
    load_env()
    base = Path(__file__).resolve().parents[4].parent / "evals" / "suites" / "bakeoff"
    qdirs = find_question_dirs(base)          # before any key or client work
    require_key("OPENAI_API_KEY")
    require_key("GEMINI_API_KEY")
    cfg = load_bakeoff_config()
    out: dict = {}
    rankers: list[AudioRanker] = [
        OpenAIRanker(cfg["openai"]["scoring_audio_model"]),
        GeminiRanker(cfg["gemini"]["scoring_audio_model"]),
    ]
    for ranker in rankers:
        trials, api_failures, parse_failures, failure_details = run_trials(ranker, qdirs)
        out[ranker.name] = {"accuracy": accuracy(trials), "api_failures": api_failures,
                            "parse_failures": parse_failures, "failure_details": failure_details,
                            "trials": [t.__dict__ for t in trials]}
    (base / "out").mkdir(parents=True, exist_ok=True)
    (base / "out" / "discrimination.json").write_text(json.dumps(out, indent=2, default=str))
    print(json.dumps({k: {"accuracy": v["accuracy"], "trials": len(v["trials"]),
                          "api_failures": v["api_failures"],
                          "parse_failures": v["parse_failures"]} for k, v in out.items()},
                     indent=2))


if __name__ == "__main__":
    main()
