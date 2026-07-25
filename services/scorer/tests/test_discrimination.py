from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scorer.bakeoff.discrimination import (
    PROMPT,
    TRUTH,
    OpenAIRanker,
    RankerAPIError,
    RankerParseError,
    Trial,
    accuracy,
    find_question_dirs,
    parse_ranking_reply,
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
            raise RankerParseError("Expecting value: line 1 column 1 (char 0)")
        return super().rank(labeled, prompt)


class ExplodingRanker(FakeRankerFromTruth):
    """First call fails at the API boundary, second fails to parse, rest are fine
    — exercises both branches of the api/parse failure taxonomy in one ranker."""
    name = "exploder"

    def __init__(self):
        self.calls = 0

    def rank(self, labeled, prompt):
        self.calls += 1
        if self.calls == 1:
            try:
                raise ConnectionError("network unreachable")
            except ConnectionError as exc:
                raise RankerAPIError(str(exc)) from exc
        if self.calls == 2:
            try:
                raise ValueError("Expecting value: line 1 column 1 (char 0)")
            except ValueError as exc:
                raise RankerParseError(str(exc)) from exc
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
    trials, api_failures, parse_failures, failure_details = run_trials(
        ranker, find_question_dirs(tmp_path))
    # 6 permutations attempted; the 3 unparseable replies are counted, not fatal
    assert len(trials) == 3
    assert api_failures == 0
    assert parse_failures == 3
    assert len(failure_details) == 3
    assert accuracy(trials) == 1.0          # failures stay out of the denominator


def test_run_trials_splits_api_and_parse_failures_with_details(tmp_path):
    _question_dir(tmp_path, "q1")
    ranker = ExplodingRanker()
    trials, api_failures, parse_failures, failure_details = run_trials(
        ranker, find_question_dirs(tmp_path))
    # 6 permutations attempted; 1 dies at the API call, 1 dies parsing the reply
    assert len(trials) == 4
    assert api_failures == 1
    assert parse_failures == 1
    assert len(failure_details) == 2
    # detail unwraps to the *original* exception, not the RankerAPIError/
    # RankerParseError wrapper — the real cause is never hidden
    assert failure_details[0] == "ConnectionError: network unreachable"
    assert failure_details[1] == "ValueError: Expecting value: line 1 column 1 (char 0)"


def test_parse_ranking_reply_handles_clean_json():
    assert parse_ranking_reply('{"ranking": ["A", "B", "C"]}') == ["A", "B", "C"]


def test_parse_ranking_reply_strips_markdown_code_fence_with_language_tag():
    text = '```json\n{"ranking": ["B", "A", "C"]}\n```'
    assert parse_ranking_reply(text) == ["B", "A", "C"]


def test_parse_ranking_reply_strips_markdown_code_fence_without_language_tag():
    text = '```\n{"ranking": ["C", "B", "A"]}\n```'
    assert parse_ranking_reply(text) == ["C", "B", "A"]


def test_parse_ranking_reply_extracts_json_from_surrounding_prose():
    text = ("Sure, here is my ranking based on delivery quality: "
            '{"ranking": ["A", "C", "B"]} Let me know if you need anything else!')
    assert parse_ranking_reply(text) == ["A", "C", "B"]


def test_parse_ranking_reply_raises_when_no_json_object_present():
    with pytest.raises(ValueError):
        parse_ranking_reply("I cannot comply with this request.")


def test_openai_ranker_does_not_request_json_object_response_format(tmp_path):
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
    assert "response_format" not in kwargs


def test_openai_ranker_parses_a_fenced_reply(tmp_path):
    clip = tmp_path / "fluent.wav"
    clip.write_bytes(b"RIFF")
    ranker = object.__new__(OpenAIRanker)
    ranker.name, ranker.model = "openai/gpt-audio", "gpt-audio"
    ranker.client = MagicMock()
    ranker.client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(
            content='```json\n{"ranking": ["B", "A", "C"]}\n```'))])

    assert ranker.rank([("A", clip)], PROMPT) == ["B", "A", "C"]


def test_openai_ranker_wraps_api_exceptions_as_ranker_api_error(tmp_path):
    clip = tmp_path / "fluent.wav"
    clip.write_bytes(b"RIFF")
    ranker = object.__new__(OpenAIRanker)
    ranker.name, ranker.model = "openai/gpt-audio", "gpt-audio"
    ranker.client = MagicMock()
    ranker.client.chat.completions.create.side_effect = RuntimeError(
        "Invalid parameter: 'response_format' of type 'json_object' is not "
        "supported with this model.")

    with pytest.raises(RankerAPIError):
        ranker.rank([("A", clip)], PROMPT)


def test_openai_ranker_wraps_unparseable_replies_as_ranker_parse_error(tmp_path):
    clip = tmp_path / "fluent.wav"
    clip.write_bytes(b"RIFF")
    ranker = object.__new__(OpenAIRanker)
    ranker.name, ranker.model = "openai/gpt-audio", "gpt-audio"
    ranker.client = MagicMock()
    ranker.client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(
            content="Sorry, I can't help with that."))])

    with pytest.raises(RankerParseError):
        ranker.rank([("A", clip)], PROMPT)
