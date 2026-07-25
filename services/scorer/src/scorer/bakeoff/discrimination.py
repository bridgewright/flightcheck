from __future__ import annotations
import base64, itertools, json, os
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
    return sum(t.correct for t in trials) / len(trials)


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
        r = self.client.chat.completions.create(
            model=self.model, messages=[{"role": "user", "content": content}])
        return json.loads(r.choices[0].message.content)["ranking"]


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
        r = self.client.models.generate_content(
            model=self.model, contents=parts,
            config={"response_mime_type": "application/json"})
        return json.loads(r.text)["ranking"]


def main() -> None:
    from ..realtime_probe.openai_probe import load_bakeoff_config
    cfg = load_bakeoff_config()
    base = Path(__file__).resolve().parents[4].parent / "evals" / "suites" / "bakeoff"
    out: dict = {}
    rankers: list[AudioRanker] = [
        OpenAIRanker(cfg["openai"]["scoring_audio_model"]),
        GeminiRanker(cfg["gemini"]["scoring_audio_model"]),
    ]
    for ranker in rankers:
        trials: list[Trial] = []
        for qdir in sorted((base / "clips").glob("q*")):
            clips = {k: qdir / f"{k}.wav" for k in TRUTH}
            if not all(p.exists() for p in clips.values()):
                raise SystemExit(f"missing clips in {qdir} — see manual_protocol.md")
            for perm in itertools.permutations(TRUTH):
                trials.append(rank_clips(ranker, clips, perm))
        out[ranker.name] = {"accuracy": accuracy(trials),
                            "trials": [t.__dict__ for t in trials]}
    (base / "out").mkdir(exist_ok=True)
    (base / "out" / "discrimination.json").write_text(json.dumps(out, indent=2, default=str))
    print(json.dumps({k: v["accuracy"] for k, v in out.items()}, indent=2))


if __name__ == "__main__":
    main()
