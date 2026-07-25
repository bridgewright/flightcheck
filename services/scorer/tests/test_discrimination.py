from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scorer.bakeoff.discrimination import (
    PROMPT,
    TRUTH,
    OpenAIRanker,
    Trial,
    accuracy,
    find_question_dirs,
    rank_clips,
    run_trials,
)


class FakeRankerFromTruth:
    name = "oracle"

    def rank(self, labeled, prompt):
        order = {"fluent": 0, "filler": 1, "hesitant": 2}
        return [letter for letter, path in sorted(labeled, key=lambda lp: order[Path(lp[1]).stem])]


class FlakyRanker(FakeRankerFromTruth):
    """Ranks correctly, but every other reply is unparseable — the real failure."""
    name = "flaky"

    def __init__(self):
        self.calls = 0

    def rank(self, labeled, prompt):
        self.calls += 1
        if self.calls % 2 == 0:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return super().rank(labeled, prompt)


def _question_dir(base: Path, name: str) -> Path:
    qdir = base / "clips" / name
    qdir.mkdir(parents=True)
    for k in TRUTH:
        (qdir / f"{k}.wav").write_bytes(b"")
    return qdir


def test_rank_clips_marks_correct_when_order_matches_truth(tmp_path):
    clips = {k: tmp_path / f"{k}.wav" for k in ("fluent", "filler", "hesitant")}
    for p in clips.values():
        p.write_bytes(b"")
    # letters are assigned in permutation order; the oracle ranker reconstructs
    # truth from the clip path stems regardless of the assigned letters.
    trial = rank_clips(FakeRankerFromTruth(), clips)
    assert trial.correct


def test_accuracy_aggregates():
    trials = [Trial("m", ("A",), ["A"], True), Trial("m", ("A",), ["A"], False)]
    assert accuracy(trials) == 0.5


def test_accuracy_of_no_trials_is_zero_not_a_crash():
    assert accuracy([]) == 0.0


def test_find_question_dirs_exits_with_a_friendly_message_when_absent(tmp_path):
    (tmp_path / "clips").mkdir()
    with pytest.raises(SystemExit) as exc:
        find_question_dirs(tmp_path)
    assert "manual_protocol.md" in str(exc.value)


def test_find_question_dirs_returns_sorted_question_dirs(tmp_path):
    _question_dir(tmp_path, "q2")
    _question_dir(tmp_path, "q1")
    assert [p.name for p in find_question_dirs(tmp_path)] == ["q1", "q2"]


def test_run_trials_records_parse_failures_instead_of_aborting_the_run(tmp_path):
    _question_dir(tmp_path, "q1")
    ranker = FlakyRanker()
    trials, parse_failures = run_trials(ranker, find_question_dirs(tmp_path))
    # 6 permutations attempted; the 3 unparseable replies are counted, not fatal
    assert len(trials) == 3
    assert parse_failures == 3
    assert accuracy(trials) == 1.0          # failures stay out of the denominator


def test_openai_ranker_requests_a_json_object_response(tmp_path):
    clip = tmp_path / "fluent.wav"
    clip.write_bytes(b"RIFF")
    ranker = object.__new__(OpenAIRanker)   # no network, no client construction
    ranker.name, ranker.model = "openai/gpt-audio", "gpt-audio"
    ranker.client = MagicMock()
    ranker.client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(
            content='{"ranking": ["A", "B", "C"]}'))])

    assert ranker.rank([("A", clip)], PROMPT) == ["A", "B", "C"]
    kwargs = ranker.client.chat.completions.create.call_args.kwargs
    assert kwargs["response_format"] == {"type": "json_object"}
